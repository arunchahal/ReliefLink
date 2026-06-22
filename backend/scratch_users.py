from app import app, db, User
with app.app_context():
    users = User.query.all()
    for u in users:
        print(f"ID: {u.id}, Name: {u.name}, Role: {u.role}, Phone: {u.phone}")
