from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from werkzeug.utils import secure_filename
from functools import wraps
from dotenv import load_dotenv
from pathlib import Path
import mysql.connector
import pandas as pd
import os
import zipfile
import tempfile
import shutil
import json
import geopandas as gpd
import re
import secrets
import hmac
import base64
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
from difflib import SequenceMatcher


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-change-me")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024

# =========================================================
# 🔐 AUTHENTICATION (users stored in MySQL, passwords hashed)
#
# No username/password is written in the code. The first admin is
# created with:  python create_admin.py
# After that, the admin adds more users from the "Add User" page.
# =========================================================
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "0") == "1",
)

MIN_PASSWORD_LENGTH = 8
VALID_ROLES = ("admin", "user")

PUBLIC_ENDPOINTS = {"login", "static", "health"}

# Normal users: only the SPASIS Locator page + the APIs it needs.
USER_ALLOWED_ENDPOINTS = {
    "progress",
    "api_progress_add",
    "get_map_boundaries",
    "get_counts",
    "logout",
}

# Admin-only pages (everything not listed here is also admin-only,
# because admins may use every endpoint).
ADMIN_ONLY_ENDPOINTS = {
    "admin_users",
    "admin_users_add",
    "admin_users_delete",
    "admin_users_password",
    "admin_users_toggle",
}


def ensure_users_table():
    """Create the users table if it does not exist yet."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'user',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_users_username (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        db.commit()
    finally:
        cursor.close()
        db.close()


def get_csrf_token():
    token = session.get("_csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf"] = token
    return token


app.jinja_env.globals["csrf_token"] = get_csrf_token


def check_csrf():
    sent = request.form.get("_csrf", "")
    expected = session.get("_csrf", "")
    return bool(expected) and hmac.compare_digest(sent, expected)


def is_admin():
    return session.get("role") == "admin"


@app.context_processor
def inject_auth():
    return {"is_admin": is_admin(), "current_username": session.get("username")}


@app.before_request
def require_login():
    # Only the login page, static assets and health check are public.
    if request.endpoint in PUBLIC_ENDPOINTS:
        return None
    if not session.get("user_logged_in"):
        return redirect(url_for("login", next=request.path))
    if is_admin():
        return None
    # Normal users are intentionally restricted to the SPASIS Locator.
    if request.endpoint not in USER_ALLOWED_ENDPOINTS:
        return redirect(url_for("progress"))
    return None


def home_for_session():
    return url_for("index") if is_admin() else url_for("progress")


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_logged_in"):
        return redirect(home_for_session())

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            try:
                cursor.execute(
                    "SELECT id, username, password_hash, role, is_active "
                    "FROM users WHERE username = %s",
                    (username,),
                )
                user = cursor.fetchone()
            finally:
                cursor.close()
                db.close()
        except mysql.connector.Error:
            app.logger.exception("Login DB error")
            return render_template(
                "login.html",
                error="Database is not reachable. Please try again."
            ), 503

        # Always run a hash check so response time does not reveal
        # whether the username exists.
        stored_hash = user["password_hash"] if user else DUMMY_HASH
        password_ok = check_password_hash(stored_hash, password)

        if user and password_ok and user["is_active"]:
            session.clear()
            session["user_logged_in"] = True
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            return redirect(home_for_session())

        error = "Invalid username or password."

    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# =========================================================
# 👤 ADMIN: USER MANAGEMENT
# =========================================================
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.@-]{3,50}$")


def _users_page(error=None, success=None, status=200):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, username, role, is_active, created_at "
            "FROM users ORDER BY role, username"
        )
        users = cursor.fetchall()
    finally:
        cursor.close()
        db.close()
    return render_template(
        "admin_users.html",
        users=users,
        error=error,
        success=success,
        min_password=MIN_PASSWORD_LENGTH,
    ), status


def _count_active_admins(cursor, exclude_id=None):
    sql = "SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1"
    params = ()
    if exclude_id is not None:
        sql += " AND id <> %s"
        params = (exclude_id,)
    cursor.execute(sql, params)
    return cursor.fetchone()[0]


@app.get("/admin/users")
def admin_users():
    return _users_page(
        success=request.args.get("ok"),
        error=request.args.get("err"),
    )


@app.post("/admin/users/add")
def admin_users_add():
    if not check_csrf():
        return _users_page(error="Session expired. Please try again.", status=400)

    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm = request.form.get("confirm_password", "")
    role = request.form.get("role", "user")

    if role not in VALID_ROLES:
        role = "user"
    if not USERNAME_RE.match(username):
        return _users_page(
            error="Username must be 3-50 characters: letters, numbers, . _ - @ only.",
            status=400,
        )
    if len(password) < MIN_PASSWORD_LENGTH:
        return _users_page(
            error=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            status=400,
        )
    if password != confirm:
        return _users_page(error="Passwords do not match.", status=400)

    db = get_db()
    cursor = db.cursor()
    try:
        try:
            cursor.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (%s,%s,%s)",
                (username, generate_password_hash(password), role),
            )
            db.commit()
        except mysql.connector.IntegrityError:
            return _users_page(error="This username already exists.", status=409)
    finally:
        cursor.close()
        db.close()

    return redirect(url_for("admin_users", ok=f"User '{username}' added."))


@app.post("/admin/users/<int:uid>/delete")
def admin_users_delete(uid):
    if not check_csrf():
        return _users_page(error="Session expired. Please try again.", status=400)
    if uid == session.get("user_id"):
        return redirect(url_for("admin_users", err="You cannot delete your own account."))

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("SELECT role, is_active FROM users WHERE id=%s", (uid,))
        row = cursor.fetchone()
        if not row:
            return redirect(url_for("admin_users", err="User not found."))
        if row[0] == "admin" and row[1] and _count_active_admins(cursor, uid) == 0:
            return redirect(url_for("admin_users", err="Cannot delete the last active admin."))
        cursor.execute("DELETE FROM users WHERE id=%s", (uid,))
        db.commit()
    finally:
        cursor.close()
        db.close()
    return redirect(url_for("admin_users", ok="User deleted."))


@app.post("/admin/users/<int:uid>/toggle")
def admin_users_toggle(uid):
    """Enable / disable a user without deleting them."""
    if not check_csrf():
        return _users_page(error="Session expired. Please try again.", status=400)
    if uid == session.get("user_id"):
        return redirect(url_for("admin_users", err="You cannot disable your own account."))

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("SELECT role, is_active FROM users WHERE id=%s", (uid,))
        row = cursor.fetchone()
        if not row:
            return redirect(url_for("admin_users", err="User not found."))
        if row[0] == "admin" and row[1] and _count_active_admins(cursor, uid) == 0:
            return redirect(url_for("admin_users", err="Cannot disable the last active admin."))
        cursor.execute("UPDATE users SET is_active = 1 - is_active WHERE id=%s", (uid,))
        db.commit()
    finally:
        cursor.close()
        db.close()
    return redirect(url_for("admin_users", ok="User status updated."))


@app.post("/admin/users/<int:uid>/password")
def admin_users_password(uid):
    if not check_csrf():
        return _users_page(error="Session expired. Please try again.", status=400)
    password = request.form.get("password", "")
    if len(password) < MIN_PASSWORD_LENGTH:
        return redirect(url_for(
            "admin_users",
            err=f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        ))

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "UPDATE users SET password_hash=%s WHERE id=%s",
            (generate_password_hash(password), uid),
        )
        db.commit()
    finally:
        cursor.close()
        db.close()
    return redirect(url_for("admin_users", ok="Password updated."))


# =========================================================
# 🔌 DATABASE CONNECTION
# =========================================================
def get_db():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "na_pp_db"),
        port=int(os.getenv("DB_PORT", "3306")),
        connection_timeout=int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
    )


# Random hash used to equalise login timing for unknown usernames.
DUMMY_HASH = generate_password_hash(secrets.token_hex(16))

try:
    ensure_users_table()
except Exception:  # DB may be down at import time; log and carry on
    app.logger.exception("Could not ensure users table at startup")


@app.get("/health")
def health():
    """Simple deployment/uptime health check."""
    db = None
    cursor = None
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        return jsonify({"status": "ok", "database": "ok"})
    except Exception:
        app.logger.exception("Health check failed")
        return jsonify({"status": "error", "database": "unavailable"}), 503
    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


@app.errorhandler(413)
def request_entity_too_large(_error):
    return jsonify({"success": False, "message": "Uploaded file is too large."}), 413


# =========================================================
# 🔷 HOME
# =========================================================
@app.route("/")
def index():
    # Admin sees the Dashboard; normal users go to the SPASIS Locator.
    if is_admin():
        return _dashboard_page()
    return redirect(url_for("progress"))


def _dashboard_page():

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT id, division_name
            FROM divisions
            ORDER BY division_name
        """)

        divisions = [
            row["division_name"]
            for row in cursor.fetchall()
        ]

        return render_template(
            "index.html",
            divisions=divisions
        )

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 DISTRICT BY DIVISION
# =========================================================
@app.route("/district/<division>")
def get_district(division):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT d.district_name
            FROM districts d
            INNER JOIN divisions v
                ON d.division_id = v.id
            WHERE v.division_name = %s
            ORDER BY d.district_name
        """, (division,))

        data = [
            row["district_name"]
            for row in cursor.fetchall()
        ]

        return jsonify(data)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 TEHSIL BY DIVISION + DISTRICT
# =========================================================
@app.route("/tehsil/<division>/<district>")
def get_tehsil(division, district):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT DISTINCT t.tehsil_name
            FROM tehsils t
            INNER JOIN districts d
                ON t.district_id = d.id
            INNER JOIN divisions v
                ON d.division_id = v.id
            WHERE v.division_name = %s
              AND d.district_name = %s
            ORDER BY t.tehsil_name
        """, (
            division,
            district
        ))

        data = [
            row["tehsil_name"]
            for row in cursor.fetchall()
        ]

        return jsonify(data)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 NA BY DIVISION + DISTRICT + TEHSIL
# =========================================================
@app.route("/na/<division>/<district>/<tehsil>")
def get_na(division, district, tehsil):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT DISTINCT a.na
            FROM areas a
            INNER JOIN tehsils t
                ON a.tehsil_id = t.id
            INNER JOIN districts d
                ON t.district_id = d.id
            INNER JOIN divisions v
                ON d.division_id = v.id
            WHERE v.division_name = %s
              AND d.district_name = %s
              AND t.tehsil_name = %s
              AND a.na IS NOT NULL
              AND TRIM(a.na) != ''
            ORDER BY a.na
        """, (
            division,
            district,
            tehsil
        ))

        data = [
            row["na"]
            for row in cursor.fetchall()
        ]

        return jsonify(data)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 PP BY DIVISION + DISTRICT + TEHSIL + NA
# =========================================================
@app.route("/pp/<division>/<district>/<tehsil>/<na>")
def get_pp(division, district, tehsil, na):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT DISTINCT a.pp
            FROM areas a
            INNER JOIN tehsils t
                ON a.tehsil_id = t.id
            INNER JOIN districts d
                ON t.district_id = d.id
            INNER JOIN divisions v
                ON d.division_id = v.id
            WHERE v.division_name = %s
              AND d.district_name = %s
              AND t.tehsil_name = %s
              AND a.na = %s
              AND a.pp IS NOT NULL
              AND TRIM(a.pp) != ''
            ORDER BY a.pp
        """, (
            division,
            district,
            tehsil,
            na
        ))

        data = [
            row["pp"]
            for row in cursor.fetchall()
        ]

        return jsonify(data)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 AREA ROW -> JSON
# =========================================================
def area_to_dict(r):

    return {
        "id": r.get("id"),

        "name": r.get("boundary"),
        "boundary": r.get("boundary"),

        "site_name": r.get("site_name"),

        "executing_agency": r.get("executing_agency"),
        "installation": r.get("installation"),

        "lat": (
            float(r["lat"])
            if r.get("lat") is not None
            else None
        ),

        "lng": (
            float(r["lng"])
            if r.get("lng") is not None
            else None
        ),

        "division": r.get("division_name"),
        "district": r.get("district_name"),
        "tehsil": r.get("tehsil_name"),

        "na": r.get("na"),
        "pp": r.get("pp"),

        "plant_type": r.get("plant_type"),
        "category": r.get("category")
    }


# =========================================================
# 🔷 COMMON AREA SELECT
# =========================================================
AREA_SELECT = """
    SELECT
        a.id,
        a.boundary,
        a.site_name,
        a.executing_agency,
        a.installation,
        a.lat,
        a.lng,
        a.na,
        a.pp,
        a.plant_type,
        a.category,

        t.tehsil_name,
        d.district_name,
        v.division_name

    FROM areas a

    INNER JOIN tehsils t
        ON a.tehsil_id = t.id

    INNER JOIN districts d
        ON t.district_id = d.id

    INNER JOIN divisions v
        ON d.division_id = v.id
"""


# =========================================================
# 🔷 DIVISION WISE FULL DATA
# =========================================================
@app.route("/division_data/<division>")
def get_division_data(division):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            AREA_SELECT + """
            WHERE v.division_name = %s

            ORDER BY
                d.district_name,
                t.tehsil_name,
                a.site_name,
                a.na,
                a.pp,
                a.id
            """,
            (division,)
        )

        rows = cursor.fetchall()

        return jsonify([
            area_to_dict(r)
            for r in rows
        ])

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 TEHSIL WISE FULL DATA
# =========================================================
@app.route("/tehsil_data/<division>/<district>/<tehsil>")
def get_tehsil_data(division, district, tehsil):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            AREA_SELECT + """
            WHERE v.division_name = %s
              AND d.district_name = %s
              AND t.tehsil_name = %s

            ORDER BY
                a.site_name,
                a.na,
                a.pp,
                a.id
            """,
            (
                division,
                district,
                tehsil
            )
        )

        rows = cursor.fetchall()

        return jsonify([
            area_to_dict(r)
            for r in rows
        ])

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 NA WISE FULL DATA
# =========================================================
@app.route("/na_data/<division>/<district>/<tehsil>/<na>")
def get_na_data(division, district, tehsil, na):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            AREA_SELECT + """
            WHERE v.division_name = %s
              AND d.district_name = %s
              AND t.tehsil_name = %s
              AND a.na = %s

            ORDER BY
                a.site_name,
                a.pp,
                a.plant_type,
                a.category,
                a.id
            """,
            (
                division,
                district,
                tehsil,
                na
            )
        )

        rows = cursor.fetchall()

        return jsonify([
            area_to_dict(r)
            for r in rows
        ])

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 DISTRICT WISE FULL DATA
# =========================================================
@app.route("/district_data/<district>")
def get_district_data(district):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            AREA_SELECT + """
            WHERE d.district_name = %s

            ORDER BY
                t.tehsil_name,
                a.site_name,
                a.na,
                a.pp,
                a.id
            """,
            (district,)
        )

        rows = cursor.fetchall()

        return jsonify([
            area_to_dict(r)
            for r in rows
        ])

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 BOUNDARY / PP DATA
# =========================================================
@app.route("/boundary/<division>/<district>/<tehsil>/<na>/<pp>")
def get_boundary(division, district, tehsil, na, pp):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            AREA_SELECT + """
            WHERE v.division_name = %s
              AND d.district_name = %s
              AND t.tehsil_name = %s
              AND a.na = %s
              AND a.pp = %s

            ORDER BY
                a.site_name,
                a.plant_type,
                a.category,
                a.id
            """,
            (
                division,
                district,
                tehsil,
                na,
                pp
            )
        )

        rows = cursor.fetchall()

        return jsonify([
            area_to_dict(r)
            for r in rows
        ])

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 FILTERED COUNTS
# =========================================================
@app.route("/filtered_counts")
def filtered_counts():

    division = request.args.get(
        "division",
        ""
    ).strip()

    district = request.args.get(
        "district",
        ""
    ).strip()

    tehsil = request.args.get(
        "tehsil",
        ""
    ).strip()

    na = request.args.get(
        "na",
        ""
    ).strip()

    pp = request.args.get(
        "pp",
        ""
    ).strip()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:

        # =====================================================
        # 1️⃣ DIVISION SELECTED
        # =====================================================
        if division and not district:

            cursor.execute("""
                SELECT COUNT(DISTINCT d.id) AS districts
                FROM districts d
                INNER JOIN divisions v
                    ON d.division_id = v.id
                WHERE v.division_name = %s
            """, (division,))

            result = cursor.fetchone()

            response = {
                "districts": result["districts"] or 0,
                "tehsils": 0,
                "nas": 0,
                "pps": 0,
                "plants": 0
            }

        # =====================================================
        # 2️⃣ DISTRICT SELECTED
        # =====================================================
        elif district and not tehsil:

            cursor.execute("""
                SELECT COUNT(DISTINCT t.id) AS tehsils
                FROM tehsils t
                INNER JOIN districts d
                    ON t.district_id = d.id
                INNER JOIN divisions v
                    ON d.division_id = v.id
                WHERE d.district_name = %s
                  AND v.division_name = %s
            """, (
                district,
                division
            ))

            result = cursor.fetchone()

            response = {
                "districts": 0,
                "tehsils": result["tehsils"] or 0,
                "nas": 0,
                "pps": 0,
                "plants": 0
            }

        # =====================================================
        # 3️⃣ TEHSIL SELECTED
        # =====================================================
        elif district and tehsil and not na:

            cursor.execute("""
                SELECT
                    COUNT(DISTINCT a.na) AS nas
                FROM areas a
                INNER JOIN tehsils t
                    ON a.tehsil_id = t.id
                INNER JOIN districts d
                    ON t.district_id = d.id
                INNER JOIN divisions v
                    ON d.division_id = v.id
                WHERE v.division_name = %s
                  AND d.district_name = %s
                  AND t.tehsil_name = %s
                  AND a.na IS NOT NULL
                  AND TRIM(a.na) != ''
            """, (
                division,
                district,
                tehsil
            ))

            result = cursor.fetchone()

            response = {
                "districts": 0,
                "tehsils": 0,
                "nas": result["nas"] or 0,
                "pps": 0,
                "plants": 0
            }

        # =====================================================
        # 4️⃣ NA SELECTED
        # =====================================================
        elif district and tehsil and na and not pp:

            cursor.execute("""
                SELECT
                    COUNT(DISTINCT a.pp) AS pps
                FROM areas a
                INNER JOIN tehsils t
                    ON a.tehsil_id = t.id
                INNER JOIN districts d
                    ON t.district_id = d.id
                INNER JOIN divisions v
                    ON d.division_id = v.id
                WHERE v.division_name = %s
                  AND d.district_name = %s
                  AND t.tehsil_name = %s
                  AND a.na = %s
                  AND a.pp IS NOT NULL
                  AND TRIM(a.pp) != ''
            """, (
                division,
                district,
                tehsil,
                na
            ))

            result = cursor.fetchone()

            response = {
                "districts": 0,
                "tehsils": 0,
                "nas": 0,
                "pps": result["pps"] or 0,
                "plants": 0
            }

        # =====================================================
        # 5️⃣ PP SELECTED
        # =====================================================
        elif district and tehsil and na and pp:

            cursor.execute("""
                SELECT
                    COUNT(*) AS plants
                FROM areas a
                INNER JOIN tehsils t
                    ON a.tehsil_id = t.id
                INNER JOIN districts d
                    ON t.district_id = d.id
                INNER JOIN divisions v
                    ON d.division_id = v.id
                WHERE v.division_name = %s
                  AND d.district_name = %s
                  AND t.tehsil_name = %s
                  AND a.na = %s
                  AND a.pp = %s
            """, (
                division,
                district,
                tehsil,
                na,
                pp
            ))

            result = cursor.fetchone()

            response = {
                "districts": 0,
                "tehsils": 0,
                "nas": 0,
                "pps": 1,
                "plants": result["plants"] or 0
            }

        # =====================================================
        # NO FILTER
        # =====================================================
        else:

            response = {
                "districts": 0,
                "tehsils": 0,
                "nas": 0,
                "pps": 0,
                "plants": 0
            }

        return jsonify(response)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔷 DASHBOARD COUNTS
# =========================================================
@app.route("/counts")
def get_counts():

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:

        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM divisions
        """)
        divisions = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM districts
        """)
        districts = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM tehsils
        """)
        tehsils = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(DISTINCT na) AS total
            FROM areas
            WHERE na IS NOT NULL
              AND TRIM(na) != ''
        """)
        nas = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(DISTINCT pp) AS total
            FROM areas
            WHERE pp IS NOT NULL
              AND TRIM(pp) != ''
        """)
        pps = cursor.fetchone()["total"]

        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM areas
        """)
        plants = cursor.fetchone()["total"]

        return jsonify({
            "divisions": divisions,
            "districts": districts,
            "tehsils": tehsils,
            "nas": nas,
            "pps": pps,
            "plants": plants
        })

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔥 CARD WISE DATA
# =========================================================
@app.route("/all/<level>")
def get_all(level):

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:

        if level == "division":

            cursor.execute("""
                SELECT division_name
                FROM divisions
                ORDER BY division_name
            """)

            data = [
                {
                    "division": r["division_name"]
                }
                for r in cursor.fetchall()
            ]

        elif level == "district":

            cursor.execute("""
                SELECT district_name
                FROM districts
                ORDER BY district_name
            """)

            data = [
                {
                    "district": r["district_name"]
                }
                for r in cursor.fetchall()
            ]

        elif level == "tehsil":

            cursor.execute("""
                SELECT tehsil_name
                FROM tehsils
                ORDER BY tehsil_name
            """)

            data = [
                {
                    "tehsil": r["tehsil_name"]
                }
                for r in cursor.fetchall()
            ]

        elif level == "na":

            cursor.execute("""
                SELECT DISTINCT na
                FROM areas
                WHERE na IS NOT NULL
                  AND TRIM(na) != ''
                ORDER BY na
            """)

            data = [
                {
                    "na": r["na"]
                }
                for r in cursor.fetchall()
            ]

        elif level == "pp":

            cursor.execute("""
                SELECT DISTINCT pp
                FROM areas
                WHERE pp IS NOT NULL
                  AND TRIM(pp) != ''
                ORDER BY pp
            """)

            data = [
                {
                    "pp": r["pp"]
                }
                for r in cursor.fetchall()
            ]

        else:
            data = []

        return jsonify(data)

    finally:
        cursor.close()
        db.close()


# =========================================================
# 🔥 EXCEL IMPORT
# =========================================================

UPLOAD_FOLDER = str(BASE_DIR / "uploads")

ALLOWED_EXTENSIONS = {
    "xlsx",
    "xls"
}

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

os.makedirs(
    UPLOAD_FOLDER,
    exist_ok=True
)


# =========================================================
# FILE TYPE CHECK
# =========================================================
def allowed_file(filename):

    return (
        "." in filename
        and
        filename.rsplit(
            ".",
            1
        )[1].lower() in ALLOWED_EXTENSIONS
    )


# =========================================================
# CLEAN VALUE
# =========================================================
def clean_value(value):

    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    value = str(value).strip()

    if value == "":
        return None

    return value


# =========================================================
# CLEAN NUMBER
# =========================================================
def clean_number(value):

    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    try:
        return float(value)
    except Exception:
        return None


# =========================================================
# NORMALIZE TEXT
# =========================================================
def normalize_name(value):

    if value is None:
        return ""

    try:
        if pd.isna(value):
            return ""
    except Exception:
        pass

    value = str(value).strip().lower()

    value = (
        value
        .replace("’", "'")
        .replace("`", "'")
        .replace("–", "-")
        .replace("—", "-")
    )

    value = re.sub(
        r"[._(),/\\\-]+",
        " ",
        value
    )

    value = re.sub(
        r"[^a-z0-9\s]",
        " ",
        value
    )

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip()


# =========================================================
# COMPACT NAME
# =========================================================
def compact_name(value):

    return normalize_name(value).replace(" ", "")


# =========================================================
# TOKEN LIST
# =========================================================
def token_list(value):

    normalized = normalize_name(value)

    if not normalized:
        return []

    return normalized.split()


# =========================================================
# ABBREVIATION COMPATIBLE
# =========================================================
def abbreviation_compatible(name1, name2):

    a = token_list(name1)
    b = token_list(name2)

    if not a or not b:
        return False

    if len(a) != len(b):
        return False

    for x, y in zip(a, b):

        if x == y:
            continue

        if len(x) == 1 and y.startswith(x):
            continue

        if len(y) == 1 and x.startswith(y):
            continue

        return False

    return True


# =========================================================
# SIMILARITY SCORE
# =========================================================
def similarity_score(name1, name2):

    a = normalize_name(name1)
    b = normalize_name(name2)

    if not a or not b:
        return 0.0

    if a == b:
        return 1.0

    if compact_name(a) == compact_name(b):
        return 1.0

    if abbreviation_compatible(a, b):
        return 0.98

    return SequenceMatcher(
        None,
        a,
        b
    ).ratio()


# =========================================================
# NAMES MATCH
# =========================================================
def names_match(
    name1,
    name2,
    threshold=0.90
):

    a = normalize_name(name1)
    b = normalize_name(name2)

    if not a or not b:
        return False

    if a == b:
        return True

    if a.replace(" ", "") == b.replace(" ", ""):
        return True

    if abbreviation_compatible(a, b):
        return True

    score = similarity_score(a, b)

    return score >= threshold


# =========================================================
# TEXT BLANK CHECK
# =========================================================
def is_blank(value):

    if value is None:
        return True

    try:
        if pd.isna(value):
            return True
    except Exception:
        pass

    return str(value).strip() == ""


# =========================================================
# TEXT VALUES SAME
# =========================================================
def text_values_same(value1, value2):

    if is_blank(value1) and is_blank(value2):
        return True

    if is_blank(value1) or is_blank(value2):
        return True

    return names_match(
        value1,
        value2,
        threshold=0.98
    )


# =========================================================
# OPTIONAL FIELD CONFLICT CHECK
#
# IMPORTANT:
# LAT/LNG intentionally NOT checked here.
# Coordinates duplicate decide nahi karenge.
# =========================================================
def has_text_conflict(db_value, excel_value):

    if is_blank(db_value):
        return False

    if is_blank(excel_value):
        return False

    return not text_values_same(
        db_value,
        excel_value
    )


# =========================================================
# FIND EXISTING AREA
#
# ⭐ MAIN DUPLICATE LOGIC
#
# Core identity:
#   Tehsil + Site Name + NA + PP + Boundary
#
# Latitude/Longitude:
#   duplicate key NAHI hain
#
# Optional fields:
#   Plant Type
#   Category
#   Executing Agency
#   Installation
#
# Agar optional field dono jagah filled ho aur different ho:
#   NEW RECORD
#
# Agar DB blank ho aur Excel mein value ho:
#   SAME RECORD -> UPDATE MISSING FIELD
# =========================================================
def find_existing_area(
    cursor,
    tehsil_id,
    site_name,
    na,
    pp,
    boundary,
    plant_type=None,
    category=None,
    executing_agency=None,
    installation=None,
    lat=None,
    lng=None
):

    cursor.execute("""
        SELECT
            id,
            site_name,
            na,
            pp,
            boundary,
            plant_type,
            category,
            executing_agency,
            installation,
            lat,
            lng

        FROM areas

        WHERE tehsil_id = %s

          AND COALESCE(
              LOWER(TRIM(site_name)),
              ''
          )
          =
          COALESCE(
              LOWER(TRIM(%s)),
              ''
          )

          AND COALESCE(
              LOWER(TRIM(na)),
              ''
          )
          =
          COALESCE(
              LOWER(TRIM(%s)),
              ''
          )

          AND COALESCE(
              LOWER(TRIM(pp)),
              ''
          )
          =
          COALESCE(
              LOWER(TRIM(%s)),
              ''
          )

          AND COALESCE(
              LOWER(TRIM(boundary)),
              ''
          )
          =
          COALESCE(
              LOWER(TRIM(%s)),
              ''
          )

        ORDER BY id
    """, (
        tehsil_id,
        site_name,
        na,
        pp,
        boundary
    ))

    candidates = cursor.fetchall()

    if not candidates:
        return None

    # =====================================================
    # CHECK ALL CANDIDATES
    # =====================================================
    for candidate in candidates:

        conflict = False

        # Plant Type
        if has_text_conflict(
            candidate["plant_type"],
            plant_type
        ):
            conflict = True

        # Category
        if has_text_conflict(
            candidate["category"],
            category
        ):
            conflict = True

        # Executing Agency
        if has_text_conflict(
            candidate["executing_agency"],
            executing_agency
        ):
            conflict = True

        # Installation
        if has_text_conflict(
            candidate["installation"],
            installation
        ):
            conflict = True

        # =================================================
        # IMPORTANT
        # LAT/LNG YAHAN CHECK NAHI HO RAHE
        # =================================================

        if not conflict:
            return candidate

    # All candidates have conflicting optional values
    return None


# =========================================================
# NORMALIZE EXCEL COLUMN NAME
# =========================================================
def normalize_column_name(column):

    if column is None:
        return ""

    column = str(column).strip().lower()

    column = (
        column
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace(".", "")
        .replace("/", "")
        .replace("\\", "")
        .replace("(", "")
        .replace(")", "")
    )

    return column


# =========================================================
# EXCEL COLUMN MAPPING
# =========================================================
def normalize_excel_columns(df):

    original_columns = list(
        df.columns
    )

    normalized = {}

    for column in original_columns:

        key = normalize_column_name(
            column
        )

        if key:
            normalized[key] = column

    # =====================================================
    # COLUMN ALIASES
    # =====================================================
    column_aliases = {

        "Division": [
            "division",
            "divisionname",
            "division_name"
        ],

        "District": [
            "district",
            "districtname",
            "district_name"
        ],

        "Tehsil": [
            "tehsil",
            "tehsilname",
            "tehsil_name"
        ],

        "Site Name": [
            "sitename",
            "site",
            "siten",
            "locationname",
            "areaname",
            "site_name"
        ],

        "NA": [
            "na",
            "naname",
            "na_name",
            "nationalassembly"
        ],

        "PP": [
            "pp",
            "ppname",
            "pp_name",
            "provincialassembly"
        ],

        "Boundary": [
            "boundary",
            "boundaryname",
            "boundary_name"
        ],

        "Plant Type": [
            "planttype",
            "plant",
            "planttypename",
            "plant_type",
            "plant type"
        ],

        "Category": [
            "category",
            "categoryname",
            "category_name"
        ],

        "Executing Agency": [
            "executingagency",
            "executing_agency",
            "executing agency",
            "agency",
            "executingagencyname"
        ],

        "Installation": [
            "installation",
            "installationdate",
            "installation_date",
            "installation date"
        ],

        "Latitude": [
            "latitude",
            "lat"
        ],

        "Longitude": [
            "longitude",
            "lng",
            "long",
            "lon"
        ]
    }

    rename_map = {}

    # =====================================================
    # REQUIRED COLUMNS
    # =====================================================
    required_columns = [
        "Division",
        "District",
        "Tehsil",
        "Site Name",
        "Boundary"
    ]

    missing_required = []

    # =====================================================
    # FIND COLUMNS
    # =====================================================
    for standard_name, aliases in column_aliases.items():

        found = None

        for alias in aliases:

            normalized_alias = normalize_column_name(
                alias
            )

            if normalized_alias in normalized:

                found = normalized[
                    normalized_alias
                ]

                break

        if found:

            rename_map[
                found
            ] = standard_name

        elif standard_name in required_columns:

            missing_required.append(
                standard_name
            )

    # =====================================================
    # REQUIRED MISSING
    # =====================================================
    if missing_required:

        return None, missing_required

    # =====================================================
    # RENAME
    # =====================================================
    df = df.rename(
        columns=rename_map
    )

    # =====================================================
    # ADD OPTIONAL MISSING COLUMNS
    #
    # Excel mein column nahi bhi ho to None use hoga
    # =====================================================
    optional_columns = [
        "NA",
        "PP",
        "Plant Type",
        "Category",
        "Executing Agency",
        "Installation",
        "Latitude",
        "Longitude"
    ]

    for column in optional_columns:

        if column not in df.columns:

            df[column] = None

    return df, []


# =========================================================
# FIND HIERARCHY RECORD USING names_match
# =========================================================
def find_division(cursor, division):

    cursor.execute("""
        SELECT id, division_name
        FROM divisions
        ORDER BY id
    """)

    rows = cursor.fetchall()

    for row in rows:

        if names_match(
            division,
            row["division_name"]
        ):
            return row

    return None


# =========================================================
# FIND DISTRICT
# =========================================================
def find_district(
    cursor,
    division_id,
    district
):

    cursor.execute("""
        SELECT
            id,
            district_name,
            division_id

        FROM districts

        WHERE division_id = %s

        ORDER BY id
    """, (
        division_id,
    ))

    rows = cursor.fetchall()

    for row in rows:

        if names_match(
            district,
            row["district_name"]
        ):
            return row

    return None


# =========================================================
# FIND TEHSIL
# =========================================================
def find_tehsil(
    cursor,
    district_id,
    tehsil
):

    cursor.execute("""
        SELECT
            id,
            tehsil_name,
            district_id

        FROM tehsils

        WHERE district_id = %s

        ORDER BY id
    """, (
        district_id,
    ))

    rows = cursor.fetchall()

    for row in rows:

        if names_match(
            tehsil,
            row["tehsil_name"]
        ):
            return row

    return None


# =========================================================
# UPDATE ONLY MISSING AREA FIELDS
#
# Existing nonblank values NEVER overwrite.
# =========================================================
def update_missing_area_fields(
    cursor,
    existing_area,
    site_name,
    na,
    pp,
    boundary,
    plant_type,
    category,
    executing_agency,
    installation,
    lat,
    lng
):

    area_id = existing_area["id"]

    updates = []
    values = []

    # =====================================================
    # TEXT FIELDS
    # =====================================================
    fields = [
        (
            "site_name",
            existing_area.get("site_name"),
            site_name
        ),
        (
            "na",
            existing_area.get("na"),
            na
        ),
        (
            "pp",
            existing_area.get("pp"),
            pp
        ),
        (
            "boundary",
            existing_area.get("boundary"),
            boundary
        ),
        (
            "plant_type",
            existing_area.get("plant_type"),
            plant_type
        ),
        (
            "category",
            existing_area.get("category"),
            category
        ),
        (
            "executing_agency",
            existing_area.get("executing_agency"),
            executing_agency
        ),
        (
            "installation",
            existing_area.get("installation"),
            installation
        )
    ]

    for field_name, db_value, excel_value in fields:

        if is_blank(db_value) and not is_blank(excel_value):

            updates.append(
                f"{field_name} = %s"
            )

            values.append(
                excel_value
            )

    # =====================================================
    # LATITUDE
    #
    # Lat/Lng duplicate decide nahi karte.
    # Lekin DB blank ho to fill kar sakte hain.
    # =====================================================
    if (
        existing_area.get("lat") is None
        and lat is not None
    ):

        updates.append(
            "lat = %s"
        )

        values.append(
            lat
        )

    # =====================================================
    # LONGITUDE
    # =====================================================
    if (
        existing_area.get("lng") is None
        and lng is not None
    ):

        updates.append(
            "lng = %s"
        )

        values.append(
            lng
        )

    # =====================================================
    # NOTHING TO UPDATE
    # =====================================================
    if not updates:
        return False

    # =====================================================
    # UPDATE
    # =====================================================
    query = """
        UPDATE areas
        SET
            """ + ", ".join(updates) + """
        WHERE id = %s
    """

    values.append(
        area_id
    )

    cursor.execute(
        query,
        tuple(values)
    )

    return True


# =========================================================
# 🔥 EXCEL IMPORT ROUTE
# =========================================================
@app.route(
    "/import_excel",
    methods=["POST"]
)
def import_excel():

    # =====================================================
    # FILE CHECK
    # =====================================================
    if "file" not in request.files:

        return jsonify({
            "success": False,
            "message": "Excel file select karein."
        }), 400

    file = request.files["file"]

    if file.filename == "":

        return jsonify({
            "success": False,
            "message": "Excel file select karein."
        }), 400

    if not allowed_file(
        file.filename
    ):

        return jsonify({
            "success": False,
            "message":
                "Sirf .xlsx ya .xls file allowed hai."
        }), 400

    # =====================================================
    # READ EXCEL
    # =====================================================
    try:

        df = pd.read_excel(
            file
        )

    except Exception as e:

        return jsonify({
            "success": False,
            "message":
                f"Excel read nahi ho saki: {str(e)}"
        }), 400

    # =====================================================
    # NORMALIZE COLUMNS
    # =====================================================
    df, missing_columns = normalize_excel_columns(
        df
    )

    if missing_columns:

        return jsonify({

            "success": False,

            "message":
                "Excel mein required columns missing hain.",

            "missing_columns":
                missing_columns

        }), 400

    # =====================================================
    # EMPTY EXCEL
    # =====================================================
    if df.empty:

        return jsonify({

            "success": False,

            "message":
                "Excel file mein koi record nahi hai."

        }), 400

    # =====================================================
    # DATABASE
    # =====================================================
    db = None
    cursor = None

    inserted = 0
    updated = 0
    duplicates = 0
    invalid = 0

    errors = []

    try:

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        # =================================================
        # PROCESS EACH ROW
        # =================================================
        for index, row in df.iterrows():

            excel_row = index + 2

            try:

                # =========================================
                # READ VALUES
                # =========================================
                division = clean_value(
                    row.get("Division")
                )

                district = clean_value(
                    row.get("District")
                )

                tehsil = clean_value(
                    row.get("Tehsil")
                )

                site_name = clean_value(
                    row.get("Site Name")
                )

                na = clean_value(
                    row.get("NA")
                )

                pp = clean_value(
                    row.get("PP")
                )

                boundary = clean_value(
                    row.get("Boundary")
                )

                plant_type = clean_value(
                    row.get("Plant Type")
                )

                category = clean_value(
                    row.get("Category")
                )

                executing_agency = clean_value(
                    row.get("Executing Agency")
                )

                installation = clean_value(
                    row.get("Installation")
                )

                lat = clean_number(
                    row.get("Latitude")
                )

                lng = clean_number(
                    row.get("Longitude")
                )

                # =========================================
                # REQUIRED VALIDATION
                # =========================================
                if not division:

                    invalid += 1

                    errors.append(
                        f"Row {excel_row}: Division missing."
                    )

                    continue

                if not district:

                    invalid += 1

                    errors.append(
                        f"Row {excel_row}: District missing."
                    )

                    continue

                if not tehsil:

                    invalid += 1

                    errors.append(
                        f"Row {excel_row}: Tehsil missing."
                    )

                    continue

                if not site_name:

                    invalid += 1

                    errors.append(
                        f"Row {excel_row}: Site Name missing."
                    )

                    continue

                if not boundary:

                    invalid += 1

                    errors.append(
                        f"Row {excel_row}: Boundary missing."
                    )

                    continue

                # =========================================
                # 1️⃣ DIVISION
                # =========================================
                division_record = find_division(
                    cursor,
                    division
                )

                if division_record:

                    division_id = (
                        division_record["id"]
                    )

                else:

                    cursor.execute("""
                        INSERT INTO divisions
                        (
                            division_name
                        )
                        VALUES
                        (
                            %s
                        )
                    """, (
                        division,
                    ))

                    division_id = (
                        cursor.lastrowid
                    )

                # =========================================
                # 2️⃣ DISTRICT
                # =========================================
                district_record = find_district(
                    cursor,
                    division_id,
                    district
                )

                if district_record:

                    district_id = (
                        district_record["id"]
                    )

                else:

                    cursor.execute("""
                        INSERT INTO districts
                        (
                            district_name,
                            division_id
                        )
                        VALUES
                        (
                            %s,
                            %s
                        )
                    """, (
                        district,
                        division_id
                    ))

                    district_id = (
                        cursor.lastrowid
                    )

                # =========================================
                # 3️⃣ TEHSIL
                # =========================================
                tehsil_record = find_tehsil(
                    cursor,
                    district_id,
                    tehsil
                )

                if tehsil_record:

                    tehsil_id = (
                        tehsil_record["id"]
                    )

                else:

                    cursor.execute("""
                        INSERT INTO tehsils
                        (
                            tehsil_name,
                            district_id
                        )
                        VALUES
                        (
                            %s,
                            %s
                        )
                    """, (
                        tehsil,
                        district_id
                    ))

                    tehsil_id = (
                        cursor.lastrowid
                    )

                # =========================================
                # 4️⃣ FIND EXISTING AREA
                #
                # ⭐ ALL RELEVANT FIELDS PASS
                # =========================================
                existing_area = find_existing_area(

                    cursor,

                    tehsil_id,

                    site_name,

                    na,

                    pp,

                    boundary,

                    plant_type,

                    category,

                    executing_agency,

                    installation,

                    lat,

                    lng
                )

                # =========================================
                # 5️⃣ EXISTING RECORD
                # =========================================
                if existing_area:

                    changed = update_missing_area_fields(

                        cursor,

                        existing_area,

                        site_name,

                        na,

                        pp,

                        boundary,

                        plant_type,

                        category,

                        executing_agency,

                        installation,

                        lat,

                        lng
                    )

                    if changed:

                        updated += 1

                    else:

                        duplicates += 1

                    continue

                # =========================================
                # 6️⃣ INSERT NEW RECORD
                #
                # ⭐ LAT/LNG DUPLICATE KEY NAHI
                # =========================================
                cursor.execute("""
                    INSERT INTO areas
                    (
                        tehsil_id,
                        site_name,
                        na,
                        pp,
                        boundary,
                        plant_type,
                        category,
                        executing_agency,
                        installation,
                        lat,
                        lng
                    )

                    VALUES
                    (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )
                """, (
                    tehsil_id,
                    site_name,
                    na,
                    pp,
                    boundary,
                    plant_type,
                    category,
                    executing_agency,
                    installation,
                    lat,
                    lng
                ))

                inserted += 1

            except Exception as row_error:

                invalid += 1

                errors.append(
                    f"Row {excel_row}: {str(row_error)}"
                )

        # =====================================================
        # SAVE
        # =====================================================
        db.commit()

        # =====================================================
        # RESPONSE
        # =====================================================
        return jsonify({

            "success": True,

            "message":
                "Excel successfully import/update ho gayi.",

            "total_rows":
                len(df),

            "inserted":
                inserted,

            "updated":
                updated,

            "duplicates":
                duplicates,

            "invalid":
                invalid,

            "errors":
                errors[:100]

        })

    except Exception as e:

        if db:
            db.rollback()

        return jsonify({

            "success": False,

            "message":
                f"Import failed: {str(e)}"

        }), 500

    finally:

        if cursor:
            cursor.close()

        if db:
            db.close()


# =========================================================
# 🗺️ SHAPEFILE IMPORT HELPERS
# =========================================================

SHAPEFILE_UPLOAD_FOLDER = str(BASE_DIR / "shapefile_uploads")

os.makedirs(
    SHAPEFILE_UPLOAD_FOLDER,
    exist_ok=True
)


# =========================================================
# CLEAN SHAPE VALUE
# =========================================================
def clean_shape_value(value):

    if value is None:
        return None

    try:

        if pd.isna(value):
            return None

    except Exception:
        pass

    value = str(value).strip()

    if value == "":
        return None

    return value


# =========================================================
# NORMALIZE SHAPE COLUMN
# =========================================================
def normalize_shape_column(column):

    if column is None:
        return ""

    value = str(column).strip().lower()

    value = (
        value
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace(".", "")
    )

    return value


# =========================================================
# FIND SHAPE COLUMN
# =========================================================
def find_shape_column(
    columns,
    aliases
):

    normalized_columns = {}

    for column in columns:

        key = normalize_shape_column(
            column
        )

        if key:

            normalized_columns[
                key
            ] = column

    for alias in aliases:

        key = normalize_shape_column(
            alias
        )

        if key in normalized_columns:

            return normalized_columns[
                key
            ]

    return None


# =========================================================
# DETECT SHAPEFILE TYPE
# =========================================================
def detect_shapefile_type(
    gdf,
    filename
):

    columns = list(
        gdf.columns
    )

    filename_lower = filename.lower()

    division_col = find_shape_column(
        columns,
        [
            "Division",
            "Division_N",
            "DivisionName"
        ]
    )

    district_col = find_shape_column(
        columns,
        [
            "District",
            "District_N",
            "DistrictName"
        ]
    )

    tehsil_col = find_shape_column(
        columns,
        [
            "Tehsil",
            "Tehsil_N",
            "TehsilName"
        ]
    )

    na_col = find_shape_column(
        columns,
        [
            "NA",
            "NA_Name",
            "NAName"
        ]
    )

    pp_col = find_shape_column(
        columns,
        [
            "PP",
            "PP_Name",
            "PPName"
        ]
    )

    # =====================================================
    # FILE NAME
    # =====================================================
    if "tehsil" in filename_lower:
        return "tehsil"

    if "district" in filename_lower:
        return "district"

    if (
        "na_boundary" in filename_lower
        or
        "na-boundary" in filename_lower
    ):
        return "na"

    if (
        "pp_boundary" in filename_lower
        or
        "pp-boundary" in filename_lower
    ):
        return "pp"

    if "division" in filename_lower:
        return "division"

    # =====================================================
    # COLUMN BASED
    # =====================================================
    if pp_col:
        return "pp"

    if na_col:
        return "na"

    if tehsil_col:
        return "tehsil"

    if district_col and division_col:
        return "district"

    if division_col:
        return "division"

    return None


# =========================================================
# GET SHAPE FILES FROM ZIP
# =========================================================
def get_shape_files_from_zip(
    zip_path,
    extract_folder
):

    # Prevent Zip Slip: never allow a ZIP member to extract outside the
    # temporary extraction directory.
    extract_root = Path(extract_folder).resolve()
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        for member in zip_ref.infolist():
            target = (extract_root / member.filename).resolve()
            if os.path.commonpath([str(extract_root), str(target)]) != str(extract_root):
                raise ValueError("Unsafe path found inside shapefile ZIP.")
        zip_ref.extractall(extract_root)

    shp_files = []

    for root, dirs, files in os.walk(
        extract_folder
    ):

        for file in files:

            if file.lower().endswith(".shp"):

                shp_files.append(
                    os.path.join(
                        root,
                        file
                    )
                )

    return shp_files


# =========================================================
# SHAPE TO GEOJSON
# =========================================================
def shape_to_geojson(
    geometry
):

    if geometry is None:
        return None

    try:

        if geometry.is_empty:
            return None

    except Exception:

        return None

    try:

        return json.dumps(
            geometry.__geo_interface__
        )

    except Exception:

        return None


# =========================================================
# 🗺️ SHAPEFILE IMPORT
# =========================================================
@app.route(
    "/import_shapefiles",
    methods=["POST"]
)
def import_shapefiles():

    files = request.files.getlist(
        "files"
    )

    if not files:

        return jsonify({

            "success": False,

            "message":
                "Shapefile ZIP files select karein."

        }), 400

    db = None
    cursor = None

    inserted = 0
    updated = 0
    duplicates = 0
    invalid = 0

    errors = []

    temp_root = tempfile.mkdtemp(
        prefix="spasis_shapes_"
    )

    try:

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        # =================================================
        # PROCESS EVERY ZIP
        # =================================================
        for uploaded_file in files:

            if not uploaded_file.filename:
                continue

            original_filename = (
                uploaded_file.filename
            )

            filename = (
                original_filename.lower()
            )

            if not filename.endswith(".zip"):

                errors.append(
                    f"{original_filename}: ZIP file required."
                )

                invalid += 1

                continue

            # =================================================
            # SAVE ZIP
            # =================================================
            zip_name = os.path.basename(
                original_filename
            )

            zip_path = os.path.join(
                temp_root,
                zip_name
            )

            uploaded_file.save(
                zip_path
            )

            # =================================================
            # EXTRACT
            # =================================================
            extract_folder = os.path.join(
                temp_root,
                os.path.splitext(
                    zip_name
                )[0]
            )

            os.makedirs(
                extract_folder,
                exist_ok=True
            )

            try:

                shp_files = (
                    get_shape_files_from_zip(
                        zip_path,
                        extract_folder
                    )
                )

            except Exception as e:

                errors.append(
                    f"{zip_name}: ZIP extract failed - {str(e)}"
                )

                invalid += 1

                continue

            if not shp_files:

                errors.append(
                    f"{zip_name}: .shp file nahi mili."
                )

                invalid += 1

                continue

            # =================================================
            # PROCESS SHAPEFILES
            # =================================================
            for shp_path in shp_files:

                shp_filename = os.path.basename(
                    shp_path
                )

                try:

                    gdf = gpd.read_file(
                        shp_path
                    )

                except Exception as e:

                    errors.append(
                        f"{shp_filename}: Shapefile read failed - {str(e)}"
                    )

                    invalid += 1

                    continue

                if gdf.empty:

                    errors.append(
                        f"{shp_filename}: Shapefile empty hai."
                    )

                    invalid += 1

                    continue

                # =================================================
                # CRS
                # =================================================
                if gdf.crs is None:

                    errors.append(
                        f"{shp_filename}: CRS missing hai."
                    )

                    invalid += 1

                    continue

                # =================================================
                # WGS84
                # =================================================
                try:

                    if gdf.crs.to_epsg() != 4326:

                        gdf = gdf.to_crs(
                            epsg=4326
                        )

                except Exception as e:

                    errors.append(
                        f"{shp_filename}: CRS conversion failed - {str(e)}"
                    )

                    invalid += 1

                    continue

                # =================================================
                # TYPE
                # =================================================
                boundary_type = (
                    detect_shapefile_type(
                        gdf,
                        shp_filename
                    )
                )

                if not boundary_type:

                    errors.append(
                        f"{shp_filename}: Shapefile type identify nahi ho saki."
                    )

                    invalid += 1

                    continue

                # =================================================
                # COLUMNS
                # =================================================
                columns = list(
                    gdf.columns
                )

                division_col = find_shape_column(
                    columns,
                    [
                        "Division",
                        "Division_N",
                        "DivisionName"
                    ]
                )

                district_col = find_shape_column(
                    columns,
                    [
                        "District",
                        "District_N",
                        "DistrictName"
                    ]
                )

                tehsil_col = find_shape_column(
                    columns,
                    [
                        "Tehsil",
                        "Tehsil_N",
                        "TehsilName"
                    ]
                )

                na_col = find_shape_column(
                    columns,
                    [
                        "NA",
                        "NA_Name",
                        "NAName"
                    ]
                )

                pp_col = find_shape_column(
                    columns,
                    [
                        "PP",
                        "PP_Name",
                        "PPName"
                    ]
                )

                # =================================================
                # PROCESS ROWS
                # =================================================
                for row_number, row in gdf.iterrows():

                    shape_row = row_number + 1

                    division = (
                        clean_shape_value(
                            row[division_col]
                        )
                        if division_col
                        else None
                    )

                    district = (
                        clean_shape_value(
                            row[district_col]
                        )
                        if district_col
                        else None
                    )

                    tehsil = (
                        clean_shape_value(
                            row[tehsil_col]
                        )
                        if tehsil_col
                        else None
                    )

                    na = (
                        clean_shape_value(
                            row[na_col]
                        )
                        if na_col
                        else None
                    )

                    pp = (
                        clean_shape_value(
                            row[pp_col]
                        )
                        if pp_col
                        else None
                    )

                    # =================================================
                    # BOUNDARY NAME
                    # =================================================
                    if boundary_type == "division":

                        boundary_name = division

                    elif boundary_type == "district":

                        boundary_name = district

                    elif boundary_type == "tehsil":

                        boundary_name = tehsil

                    elif boundary_type == "na":

                        boundary_name = na

                    elif boundary_type == "pp":

                        boundary_name = pp

                    else:

                        boundary_name = None

                    # =================================================
                    # VALIDATION
                    # =================================================
                    if not boundary_name:

                        invalid += 1

                        errors.append(
                            f"{shp_filename}, row {shape_row}: boundary name missing."
                        )

                        continue

                    # =================================================
                    # GEOMETRY
                    # =================================================
                    geometry = shape_to_geojson(
                        row.geometry
                    )

                    if not geometry:

                        invalid += 1

                        errors.append(
                            f"{shp_filename}, row {shape_row}: geometry missing."
                        )

                        continue

                    # =================================================
                    # EXISTING RECORD
                    # =================================================
                    cursor.execute(
                        """
                        SELECT
                            id,
                            geometry

                        FROM map_boundaries

                        WHERE boundary_type = %s

                          AND COALESCE(
                              LOWER(TRIM(division_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                          AND COALESCE(
                              LOWER(TRIM(district_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                          AND COALESCE(
                              LOWER(TRIM(tehsil_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                          AND COALESCE(
                              LOWER(TRIM(na_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                          AND COALESCE(
                              LOWER(TRIM(pp_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                          AND COALESCE(
                              LOWER(TRIM(boundary_name)),
                              ''
                          )
                          =
                          COALESCE(
                              LOWER(TRIM(%s)),
                              ''
                          )

                        LIMIT 1
                        """,
                        (
                            boundary_type,
                            division,
                            district,
                            tehsil,
                            na,
                            pp,
                            boundary_name
                        )
                    )

                    existing = cursor.fetchone()

                    # =================================================
                    # UPDATE EXISTING
                    # =================================================
                    if existing:

                        if not existing["geometry"]:

                            cursor.execute(
                                """
                                UPDATE map_boundaries

                                SET geometry = %s

                                WHERE id = %s
                                """,
                                (
                                    geometry,
                                    existing["id"]
                                )
                            )

                            updated += 1

                        else:

                            duplicates += 1

                        continue

                    # =================================================
                    # INSERT NEW
                    # =================================================
                    cursor.execute(
                        """
                        INSERT INTO map_boundaries
                        (
                            boundary_type,
                            division_name,
                            district_name,
                            tehsil_name,
                            na_name,
                            pp_name,
                            boundary_name,
                            geometry
                        )

                        VALUES
                        (
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s
                        )
                        """,
                        (
                            boundary_type,
                            division,
                            district,
                            tehsil,
                            na,
                            pp,
                            boundary_name,
                            geometry
                        )
                    )

                    inserted += 1

        # =====================================================
        # COMMIT
        # =====================================================
        db.commit()

        return jsonify({

            "success": True,

            "message":
                "Shapefiles successfully import ho gayi hain.",

            "inserted":
                inserted,

            "updated":
                updated,

            "duplicates":
                duplicates,

            "invalid":
                invalid,

            "errors":
                errors[:100]

        })

    except Exception as e:

        if db:
            db.rollback()

        return jsonify({

            "success": False,

            "message":
                f"Shapefile import failed: {str(e)}"

        }), 500

    finally:

        if cursor:
            cursor.close()

        if db:
            db.close()

        shutil.rmtree(
            temp_root,
            ignore_errors=True
        )


# =========================================================
# 🔷 GENERIC LOCATION NAME MATCHING
# =========================================================
def location_matches(

    dashboard_division=None,
    dashboard_district=None,
    dashboard_tehsil=None,
    dashboard_na=None,
    dashboard_pp=None,

    shape_division=None,
    shape_district=None,
    shape_tehsil=None,
    shape_na=None,
    shape_pp=None

):

    pairs = [

        (
            dashboard_division,
            shape_division
        ),

        (
            dashboard_district,
            shape_district
        ),

        (
            dashboard_tehsil,
            shape_tehsil
        ),

        (
            dashboard_na,
            shape_na
        ),

        (
            dashboard_pp,
            shape_pp
        )
    ]

    for dashboard_value, shape_value in pairs:

        # Dashboard filter selected nahi
        if not dashboard_value:
            continue

        # Shapefile field missing
        if not shape_value:
            continue

        if not names_match(
            dashboard_value,
            shape_value
        ):

            return False

    return True


# =========================================================
# 🗺️ GET MAP BOUNDARIES
# =========================================================
@app.route("/map_boundaries")
def get_map_boundaries():

    dashboard_division = request.args.get(
        "division",
        ""
    ).strip()

    dashboard_district = request.args.get(
        "district",
        ""
    ).strip()

    dashboard_tehsil = request.args.get(
        "tehsil",
        ""
    ).strip()

    dashboard_na = request.args.get(
        "na",
        ""
    ).strip()

    dashboard_pp = request.args.get(
        "pp",
        ""
    ).strip()

    boundary_type = request.args.get(
        "type",
        ""
    ).strip().lower()

    db = None
    cursor = None

    try:

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        query = """
            SELECT
                id,
                boundary_type,
                division_name,
                district_name,
                tehsil_name,
                na_name,
                pp_name,
                boundary_name,
                geometry

            FROM map_boundaries

            WHERE 1 = 1
        """

        params = []

        if boundary_type:

            query += """
                AND boundary_type = %s
            """

            params.append(
                boundary_type
            )

        query += """
            ORDER BY boundary_name
        """

        cursor.execute(
            query,
            params
        )

        rows = cursor.fetchall()

        result = []

        # =====================================================
        # PYTHON MATCHING
        # =====================================================
        for row in rows:

            shape_division = row.get(
                "division_name"
            )

            shape_district = row.get(
                "district_name"
            )

            shape_tehsil = row.get(
                "tehsil_name"
            )

            shape_na = row.get(
                "na_name"
            )

            shape_pp = row.get(
                "pp_name"
            )

            matched = location_matches(

                dashboard_division=
                    dashboard_division,

                dashboard_district=
                    dashboard_district,

                dashboard_tehsil=
                    dashboard_tehsil,

                dashboard_na=
                    dashboard_na,

                dashboard_pp=
                    dashboard_pp,

                shape_division=
                    shape_division,

                shape_district=
                    shape_district,

                shape_tehsil=
                    shape_tehsil,

                shape_na=
                    shape_na,

                shape_pp=
                    shape_pp
            )

            if not matched:
                continue

            # =================================================
            # GEOMETRY
            # =================================================
            try:

                geometry = json.loads(
                    row["geometry"]
                )

            except Exception:

                geometry = None

            if not geometry:
                continue

            # =================================================
            # RESULT
            # =================================================
            result.append({

                "id":
                    row["id"],

                "type":
                    row["boundary_type"],

                "name":
                    row["boundary_name"],

                "division":
                    shape_division,

                "district":
                    shape_district,

                "tehsil":
                    shape_tehsil,

                "na":
                    shape_na,

                "pp":
                    shape_pp,

                "geometry":
                    geometry
            })

        return jsonify(
            result
        )

    except Exception as e:

        print(
            "MAP BOUNDARY ERROR:",
            str(e)
        )

        return jsonify({

            "success": False,

            "message":
                str(e)

        }), 500

    finally:

        if cursor:
            cursor.close()

        if db:
            db.close()


# =========================================================
# 📈 SPASIS LOCATOR / PROJECT LOCATOR
# =========================================================

def save_progress_images(images):
    if not isinstance(images, list):
        raise ValueError("Images must be a list.")

    if len(images) > 3:
        raise ValueError("Maximum 3 photos are allowed.")

    upload_dir = os.path.join(
        app.root_path,
        "static",
        "uploads",
        "progress_records"
    )
    os.makedirs(upload_dir, exist_ok=True)

    saved_paths = []

    for image_data in images:
        if not isinstance(image_data, str):
            raise ValueError("Invalid image data.")

        if not image_data.startswith("data:image/jpeg;base64,"):
            raise ValueError("Only JPEG camera images are accepted.")

        try:
            encoded = image_data.split(",", 1)[1]
            image_bytes = base64.b64decode(encoded, validate=True)
        except Exception:
            raise ValueError("Invalid image encoding.")

        # Maximum 5 MB per image
        if len(image_bytes) > 1 * 1024 * 1024:
            raise ValueError("Each image must be 5 MB or smaller.")

        # Validate actual JPEG file signature
        if not image_bytes.startswith(b"\xff\xd8\xff"):
            raise ValueError("Invalid JPEG image.")

        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(upload_dir, filename)

        with open(filepath, "wb") as image_file:
            image_file.write(image_bytes)

        saved_paths.append(
            f"/static/uploads/progress_records/{filename}"
        )

    return saved_paths
@app.route("/progress")
def progress():
    return render_template("progress.html")
@app.route("/api/progress", methods=["GET"])
def api_progress_list():
    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT * FROM progress_records
            ORDER BY id DESC
        """)

        rows = cursor.fetchall()

        for r in rows:
            r["lat"] = float(r["lat"]) if r["lat"] is not None else None
            r["lng"] = float(r["lng"]) if r["lng"] is not None else None
            r["start_date"] = r["start_date"].isoformat() if r["start_date"] else ""
            r["end_date"] = r["end_date"].isoformat() if r["end_date"] else ""
            r["created_at"] = str(r["created_at"])

            # Database JSON paths ko JavaScript array mein convert karein
            try:
                r["images"] = json.loads(r.get("images") or "[]")
                if not isinstance(r["images"], list):
                    r["images"] = []
            except (ValueError, TypeError):
                r["images"] = []

        return jsonify(rows)

    finally:
        cursor.close()
        db.close()

@app.route("/api/progress", methods=["POST"])
def api_progress_add():
    d = request.get_json(silent=True) or {}

    for f in (
        "division", "district", "tehsil",
        "package_name", "site_name"
    ):
        if not str(d.get(f, "")).strip():
            return jsonify({"error": f + " required"}), 400

    if d.get("lat") in (None, "") or d.get("lng") in (None, ""):
        return jsonify({"error": "GPS required"}), 400

    try:
        lat = float(d["lat"])
        lng = float(d["lng"])
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid GPS coordinates"}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({"error": "GPS coordinates out of range"}), 400

    accuracy = d.get("accuracy")

    if accuracy not in (None, ""):
        try:
            match = re.search(r"[-+]?\d+(?:\.\d+)?", str(accuracy))
            if not match:
                raise ValueError
            accuracy = float(match.group())
        except (AttributeError, TypeError, ValueError):
            return jsonify({"error": "Invalid GPS accuracy"}), 400

        if accuracy < 0:
            return jsonify({"error": "GPS accuracy cannot be negative"}), 400

    # Capture ki hui photos server par save karein
    try:
        image_paths = save_progress_images(d.get("images", []))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("""
            INSERT INTO progress_records (
                division, district, tehsil, package_name,
                site_name, plant_type, lat, lng, accuracy,
                status, start_date, end_date, remarks,
                captured_at, images
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s
            )
        """, (
            d["division"].strip(),
            d["district"].strip(),
            d["tehsil"].strip(),
            d["package_name"].strip(),
            d["site_name"].strip(),
            (d.get("plant_type") or "").strip(),
            lat,
            lng,
            accuracy if accuracy not in (None, "") else None,
            d.get("status", "In Progress"),
            d.get("start_date") or None,
            d.get("end_date") or None,
            (d.get("remarks") or "").strip(),
            d.get("captured_at", ""),
            json.dumps(image_paths)
        ))

        db.commit()
        return jsonify({
            "id": cursor.lastrowid,
            "images": image_paths
        }), 201

    except Exception:
        db.rollback()
        app.logger.exception("Progress record save failed")
        return jsonify({"error": "Record save nahi ho saka."}), 500

    finally:
        cursor.close()
        db.close()

@app.route("/api/progress/<int:rid>", methods=["DELETE"])
def api_progress_delete(rid):
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("DELETE FROM progress_records WHERE id = %s", (rid,))
        db.commit()
        return jsonify({"ok": True})
    finally:
        cursor.close(); db.close()


@app.route("/progress_records")
def progress_records():
    return render_template("progress_records.html")
# =========================================================
# GLOBAL ERROR HANDLERS
# =========================================================
@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/") or request.path in {"/health"}:
        return jsonify({"error": "Not found"}), 404
    if not session.get("user_logged_in"):
        return redirect(url_for("login"))
    return redirect(url_for("progress"))


@app.errorhandler(500)
def internal_error(_error):
    app.logger.exception("Unhandled server error")
    if request.path.startswith("/api/") or request.path in {"/health"}:
        return jsonify({"error": "Internal server error"}), 500
    return jsonify({"error": "Internal server error"}), 500


# =========================================================
# 🔷 RUN APPLICATION
# =========================================================
if __name__ == "__main__":

    # Local VS Code development. For production use a WSGI server
    # such as Gunicorn and set DEBUG=0 in the environment.
    app.run(
        debug=os.getenv("DEBUG", "1") == "1",
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000"))
    )