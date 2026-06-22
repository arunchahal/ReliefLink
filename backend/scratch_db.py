import json
from app import app, db, SOSRequest, User

with app.app_context():
    requests = SOSRequest.query.all()
    print(f"Total requests: {len(requests)}")
    for r in requests:
        print(f"ID: {r.id}, User ID: {r.user_id}, Status: {r.status}, Resolution Requested: {r.resolution_requested}, Assigned Volunteer ID: {r.assigned_volunteer_id}")
