import os

from flask import Flask, jsonify
from flask_login import LoginManager

from config import Config
from database.database import close_db, get_user_by_id, init_db
from routes.api import api_bp
from routes.nagad import nagad_bp
from routes.truecaller import truecaller_bp
from routes.web import web_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(Config)

    init_db()
    app.teardown_appcontext(close_db)

    login_manager = LoginManager()
    login_manager.login_view = "web.login"
    login_manager.login_message_category = "info"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str):
        try:
            return get_user_by_id(int(user_id))
        except ValueError:
            return None

    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(nagad_bp)
    app.register_blueprint(truecaller_bp)

    @app.errorhandler(404)
    def handle_404(_err):
        return jsonify({"ok": False, "error": "NOT_FOUND", "message": "Resource not found."}), 404

    @app.errorhandler(500)
    def handle_500(_err):
        return jsonify({"ok": False, "error": "INTERNAL_ERROR", "message": "Unexpected server error."}), 500

    return app


app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host=host, port=port, debug=debug, threaded=True)
