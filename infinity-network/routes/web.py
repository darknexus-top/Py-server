from datetime import datetime, timezone

from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config
from database.database import (
    get_all_settings,
    get_db,
    get_user_by_username,
    needs_admin_setup,
)
from routes.auth_helpers import get_or_create_csrf_token, verify_csrf
from services.nagad_service import get_nagad_status
from services.realtime_service import sanitize_text
from services.truecaller_service import get_truecaller_status

web_bp = Blueprint("web", __name__)


@web_bp.context_processor
def inject_globals():
    return {
        "csrf_token": get_or_create_csrf_token(),
        "current_path": request.path,
        "needs_setup": needs_admin_setup(),
    }


@web_bp.route("/")
def dashboard():
    return render_template("dashboard.html")


@web_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("web.dashboard"))

    setup_needed = needs_admin_setup()
    if request.method == "POST":
        if not verify_csrf(request):
            flash("Invalid CSRF token. Please try again.", "danger")
            return render_template("login.html", setup_needed=setup_needed), 403

        username = sanitize_text(request.form.get("username", "admin"), 40) or "admin"
        password = request.form.get("password", "")

        if setup_needed:
            confirm = request.form.get("confirm_password", "")
            display_name = sanitize_text(request.form.get("display_name", "Platform Administrator"), 80)
            email = sanitize_text(request.form.get("email", "admin@infinity.network"), 100)
            if len(password) < 8:
                flash("Password must be at least 8 characters.", "danger")
                return render_template("login.html", setup_needed=True), 400
            if password != confirm:
                flash("Passwords do not match.", "danger")
                return render_template("login.html", setup_needed=True), 400

            db = get_db()
            db.execute(
                "INSERT INTO users (username, display_name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    username,
                    display_name or "Platform Administrator",
                    email or "admin@infinity.network",
                    "admin",
                    generate_password_hash(password),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            db.commit()
            user = get_user_by_username(username)
            if user:
                session.permanent = True
                login_user(user)
                flash("Administrator account created and signed in.", "success")
                return redirect(url_for("web.dashboard"))

        user = get_user_by_username(username)
        if user and check_password_hash(user.password_hash, password):
            session.permanent = True
            login_user(user)
            flash("Signed in successfully.", "success")
            return redirect(url_for("web.dashboard"))

        flash("Invalid username or password.", "danger")
        return render_template("login.html", setup_needed=False), 401

    return render_template("login.html", setup_needed=setup_needed)


@web_bp.route("/logout", methods=["POST"])
@login_required
def logout():
    if not verify_csrf(request):
        return redirect(url_for("web.dashboard"))
    logout_user()
    flash("You have been signed out.", "info")
    return redirect(url_for("web.login"))


@web_bp.route("/me")
@login_required
def me():
    keys = get_db().execute(
        "SELECT id, label, key_prefix, last_used_at, created_at, revoked FROM api_keys WHERE user_id = ? ORDER BY id DESC",
        (current_user.user_id,),
    ).fetchall()
    return render_template("me.html", api_keys=[dict(k) for k in keys])


@web_bp.route("/Nagat")
@login_required
def nagad_page():
    return render_template("nagad.html", nagad=get_nagad_status())


@web_bp.route("/Truecaller")
@login_required
def truecaller_page():
    return render_template("truecaller.html", truecaller=get_truecaller_status())


@web_bp.route("/all")
@login_required
def all_integrations():
    return render_template(
        "all.html",
        nagad=get_nagad_status(),
        truecaller=get_truecaller_status(),
    )


@web_bp.route("/settings")
@login_required
def settings_page():
    return render_template("settings.html", settings=get_all_settings())
