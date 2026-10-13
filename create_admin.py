"""Create (or reset) an admin account. Password is typed at the prompt,
never stored in code or .env.

Usage:
    python create_admin.py            # create/update an admin interactively
    python create_admin.py --check    # exit code 0 if an admin exists, 1 if not
"""
import sys
import getpass

from werkzeug.security import generate_password_hash

import app as spasis  # loads .env, DB settings and ensures the users table


def admin_exists(cursor):
    cursor.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1")
    return cursor.fetchone()[0] > 0


def main():
    spasis.ensure_users_table()
    db = spasis.get_db()
    cursor = db.cursor()
    try:
        if "--check" in sys.argv:
            sys.exit(0 if admin_exists(cursor) else 1)

        username = input("Admin username: ").strip()
        if not spasis.USERNAME_RE.match(username):
            sys.exit("Username must be 3-50 chars: letters, numbers, . _ - @")

        password = getpass.getpass(f"Password (min {spasis.MIN_PASSWORD_LENGTH} chars): ")
        if len(password) < spasis.MIN_PASSWORD_LENGTH:
            sys.exit("Password too short.")
        if password != getpass.getpass("Confirm password: "):
            sys.exit("Passwords do not match.")

        cursor.execute(
            "INSERT INTO users (username, password_hash, role, is_active) "
            "VALUES (%s, %s, 'admin', 1) "
            "ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), "
            "role='admin', is_active=1",
            (username, generate_password_hash(password)),
        )
        db.commit()
        print(f"Admin '{username}' is ready. You can log in now.")
    finally:
        cursor.close()
        db.close()


if __name__ == "__main__":
    main()
