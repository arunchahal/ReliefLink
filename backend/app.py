import json
import threading
from dotenv import load_dotenv
load_dotenv()  # Load .env file from the backend directory
import math
import requests as http_requests
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from models import db, User, SOSRequest, Resource, LocationUpdate, Shelter, RiskData, SOSLog, BroadcastAlert
from config import Config
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO, emit
import os

app = Flask(__name__)

@app.route("/")
def home():
    return "ReliefLink Backend Running"

@app.get("/ip")
def ip():
    import requests
    return {
        "ip": requests.get("https://api.ipify.org").text
}

app.config.from_object(Config)
CORS(app)
db.init_app(app)
jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- Live Volunteer Location Store (in-memory) ---
online_volunteers = {}  # { volunteer_id: { 'lat': float, 'lng': float, 'sid': str, 'name': str } }
dispatch_timers = {}    # { sos_id: threading.Timer }

# --- DB Initialization ---
with app.app_context():
    db.create_all()
    # Seed mock users if none exist
    if not User.query.first():
        users = [
            User(name='Citizen Rahul', role='citizen', phone='1234567890', password=generate_password_hash('password', method='pbkdf2:sha256')),
            User(name='Volunteer Priya', role='volunteer', phone='0987654321', password=generate_password_hash('password', method='pbkdf2:sha256')),
            User(name='Admin Rajesh', role='admin', phone='1112223333', password=generate_password_hash('password', method='pbkdf2:sha256'))
        ]
        db.session.bulk_save_objects(users)
        db.session.commit()
        
        # Add a resource for the volunteer
        vol = User.query.filter_by(role='volunteer').first()
        res = Resource(volunteer_id=vol.id, food_kits=20, medical_kits=10, vehicles=2)
        db.session.add(res)
        db.session.commit()

    # Seed shelters if none exist
    if not Shelter.query.first():
        shelters = [
            Shelter(name='Central Relief Camp', latitude=28.6139, longitude=77.2090,
                    capacity=200, current_occupancy=87, has_medical=True, has_food=True,
                    contact_phone='011-2345-6789'),
            Shelter(name='Medical Aid Station - Connaught Place', latitude=28.6250, longitude=77.2150,
                    capacity=75, current_occupancy=42, has_medical=True, has_food=True,
                    contact_phone='011-2345-6790'),
            Shelter(name='Government School Shelter', latitude=28.6050, longitude=77.2200,
                    capacity=300, current_occupancy=156, has_medical=False, has_food=True,
                    contact_phone='011-2345-6791'),
            Shelter(name='Community Hall - Karol Bagh', latitude=28.6519, longitude=77.1907,
                    capacity=150, current_occupancy=23, has_medical=True, has_food=True,
                    contact_phone='011-2345-6792'),
            Shelter(name='Stadium Emergency Camp', latitude=28.6100, longitude=77.2370,
                    capacity=500, current_occupancy=210, has_medical=True, has_food=True,
                    contact_phone='011-2345-6793'),
            Shelter(name='Temple Relief Center', latitude=28.6330, longitude=77.2100,
                    capacity=80, current_occupancy=65, has_medical=False, has_food=True,
                    contact_phone='011-2345-6794'),
        ]
        db.session.bulk_save_objects(shelters)
        db.session.commit()

    # Seed initial timeline logs for legacy SOS requests if any exist
    for req in SOSRequest.query.all():
        if not req.logs:
            log = SOSLog(
                sos_id=req.id,
                status=req.status,
                timestamp=req.timestamp,
                message=f"SOS Request initialized (Status: {req.status.upper()})"
            )
            db.session.add(log)
    db.session.commit()

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in kilometers."""
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

# --- Auth Routes ---
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    phone = data.get('phone')
    password = data.get('password')
    
    user = User.query.filter_by(phone=phone).first()
    if user and check_password_hash(user.password, password):
        access_token = create_access_token(identity=json.dumps({'id': user.id, 'role': user.role, 'name': user.name}))
        return jsonify({'token': access_token, 'user': user.to_dict()}), 200
        
    return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/api/auth/users', methods=['GET'])
def get_users():
    # Helper endpoint for dev to see available logins
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])

# --- User Routes ---
@app.route('/api/user/safe', methods=['PUT'])
@jwt_required()
def toggle_safe_status():
    current_user_data = json.loads(get_jwt_identity())
    user = User.query.get_or_404(current_user_data['id'])
    
    data = request.json
    is_safe = data.get('is_safe', False)
    user.is_safe = is_safe
    db.session.commit()
    
    return jsonify({'message': 'Safety status updated', 'is_safe': user.is_safe}), 200

# --- SOS Routes ---
@app.route('/api/sos', methods=['POST'])
@jwt_required()
def create_sos():
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'citizen':
        return jsonify({'message': 'Only citizens can create SOS requests'}), 403

    data = request.json
    # Support both single type (string) and multi-type (array)
    sos_type = data.get('type', '')
    if isinstance(sos_type, list):
        sos_type = ','.join(sos_type)

    new_sos = SOSRequest(
        user_id=current_user['id'],
        type=sos_type,
        priority=data.get('priority', 'medium'),
        latitude=data['location']['lat'],
        longitude=data['location']['lng'],
        description=data.get('description', '')
    )
    db.session.add(new_sos)
    db.session.commit()
    
    # Create SOSLog entry
    log = SOSLog(
        sos_id=new_sos.id,
        status='pending',
        message=f"SOS Broadcasted — Priority: {new_sos.priority.upper()}"
    )
    db.session.add(log)
    db.session.commit()

    # Emit socket event
    socketio.emit('sos_created', new_sos.to_dict())
    
    # Trigger cascading dispatch to nearest volunteer
    trigger_cascading_dispatch(new_sos.id)
    
    return jsonify(new_sos.to_dict()), 201

@app.route('/api/sos', methods=['GET'])
@jwt_required()
def get_all_sos():
    current_user = json.loads(get_jwt_identity())
    role = current_user['role']
    
    if role == 'citizen':
        requests = SOSRequest.query.filter_by(user_id=current_user['id']).all()
    else:
        # Volunteer and Admin can see all requests
        requests = SOSRequest.query.all()
        
    return jsonify([req.to_dict() for req in requests]), 200

@app.route('/api/sos/<int:sos_id>/accept', methods=['PUT'])
@jwt_required()
def accept_sos(sos_id):
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'volunteer':
        return jsonify({'message': 'Only volunteers can accept requests'}), 403
        
    req = SOSRequest.query.get_or_404(sos_id)
    if req.status != 'pending':
        return jsonify({'message': 'Request already accepted or resolved'}), 400
        

    # Calculate distance and ETA if volunteer location is provided
    data = request.get_json(silent=True) or {}
    volunteer_lat = data.get('volunteer_lat')
    volunteer_lng = data.get('volunteer_lng')
    if volunteer_lat is not None and volunteer_lng is not None:
        # Use OSRM routing API for road distance
        try:
            route_url = f"http://router.project-osrm.org/route/v1/driving/{volunteer_lng},{volunteer_lat};{req.longitude},{req.latitude}?overview=false"
            resp = http_requests.get(route_url, timeout=5)
            resp_json = resp.json()
            if resp_json.get('code') == 'Ok' and resp_json.get('routes'):
                distance_m = resp_json['routes'][0]['distance']
                distance_km = round(distance_m / 1000, 2)
                # Assume average speed 40 km/h (user choice)
                eta_minutes = int((distance_km / 40) * 60)
                req.volunteer_distance_km = distance_km
                req.volunteer_eta = eta_minutes
            else:
                # Fallback to straight‑line Haversine distance
                distance = haversine(req.latitude, req.longitude, volunteer_lat, volunteer_lng)
                req.volunteer_distance_km = round(distance, 2)
                req.volunteer_eta = int((distance / 40) * 60)
        except Exception as e:
            print(f"[Routing] Failed to get route: {e}")
            distance = haversine(req.latitude, req.longitude, volunteer_lat, volunteer_lng)
            req.volunteer_distance_km = round(distance, 2)
            req.volunteer_eta = int((distance / 40) * 60)
    else:
        req.volunteer_distance_km = None
        req.volunteer_eta = None
    # Ensure request is still pending
    if req.status != 'pending':
        return jsonify({'message': 'Request already accepted or resolved'}), 400
    # Assign volunteer and set status
    req.assigned_volunteer_id = current_user['id']
    req.status = 'in-progress'

    # Cancel dispatch timer if active
    if sos_id in dispatch_timers:
        dispatch_timers[sos_id].cancel()
        del dispatch_timers[sos_id]
    req.current_dispatch_volunteer_id = None
    req.dispatch_attempted_ids = ''

    # Get volunteer details
    volunteer = User.query.get(current_user['id'])
    
    # Create SOSLog entry
    log = SOSLog(
        sos_id=req.id,
        status='in-progress',
        message=f"Request accepted by Volunteer {volunteer.name}"
    )
    db.session.add(log)
    db.session.commit()

    # Emit socket event
    socketio.emit('sos_updated', req.to_dict())
    
    return jsonify(req.to_dict()), 200

@app.route('/api/sos/<int:sos_id>/status', methods=['PUT'])
@jwt_required()
def update_sos_status(sos_id):
    current_user = json.loads(get_jwt_identity())
    data = request.json
    new_status = data.get('status')
    
    if new_status not in ['pending', 'in-progress', 'resolved']:
        return jsonify({'message': 'Invalid status'}), 400
        
    req = SOSRequest.query.get_or_404(sos_id)
    
    # Only assigned volunteer or admin can update status
    if current_user['role'] == 'volunteer' and req.assigned_volunteer_id != current_user['id']:
        return jsonify({'message': 'Not assigned to this request'}), 403
        
    if current_user['role'] == 'citizen' and req.user_id != current_user['id']:
        return jsonify({'message': 'Unauthorized'}), 403
        
    # Handle resolution flow
    if new_status == 'resolved':
        if current_user['role'] == 'volunteer':
            # Volunteer requests resolution confirmation from citizen
            req.resolution_requested = True
            db.session.commit()
            # Log entry for volunteer requesting resolution
            log = SOSLog(
                sos_id=req.id,
                status='in-progress',
                message='Volunteer marked request as resolved. Awaiting citizen confirmation.'
            )
            db.session.add(log)
            db.session.commit()
            socketio.emit('sos_updated', req.to_dict())
            return jsonify(req.to_dict()), 200
        elif current_user['role'] == 'admin':
            # Admin can directly resolve
            req.status = 'resolved'
            req.resolution_confirmed = True
            db.session.commit()
            # Log entry for admin resolution
            log = SOSLog(
                sos_id=req.id,
                status='resolved',
                message='Admin resolved the SOS request.'
            )
            db.session.add(log)
            db.session.commit()
            socketio.emit('sos_updated', req.to_dict())
            return jsonify(req.to_dict()), 200
        else:
            # Citizens cannot resolve directly
            return jsonify({'message': 'Citizens cannot directly resolve. Await confirmation.'}), 403

    # For other status updates (pending, in-progress)
    req.status = new_status
    db.session.commit()
    
    # Create SOSLog entry
    status_msg = f"Status updated to {new_status.upper()}"
    if new_status == 'in-progress':
        status_msg = "SOS Request marked in progress — Volunteer dispatched"
    
    log = SOSLog(
        sos_id=req.id,
        status=new_status,
        message=status_msg
    )
    db.session.add(log)
    db.session.commit()
    
    # Emit socket event
    socketio.emit('sos_updated', req.to_dict())
    
    return jsonify(req.to_dict()), 200

# --- Live Location Tracking ---
@app.route('/api/sos/<int:sos_id>/location', methods=['POST'])
@jwt_required()
def update_location(sos_id):
    """Citizen posts their live location for an active SOS request."""
    current_user = json.loads(get_jwt_identity())
    req = SOSRequest.query.get_or_404(sos_id)

    if req.user_id != current_user['id']:
        return jsonify({'message': 'Unauthorized'}), 403

    data = request.json
    loc = LocationUpdate(
        sos_id=sos_id,
        user_id=current_user['id'],
        latitude=data['lat'],
        longitude=data['lng']
    )
    # Also update the main SOS request coordinates
    req.latitude = data['lat']
    req.longitude = data['lng']
    db.session.add(loc)
    db.session.commit()

    # Emit live location to sockets
    socketio.emit('location_updated', {
        'sos_id': sos_id,
        'lat': data['lat'],
        'lng': data['lng'],
        'timestamp': loc.timestamp.isoformat()
    })

    return jsonify(loc.to_dict()), 201

@app.route('/api/sos/<int:sos_id>/location', methods=['GET'])
@jwt_required()
def get_location_trail(sos_id):
    """Volunteer/admin fetches the location trail for an SOS request."""
    updates = LocationUpdate.query.filter_by(sos_id=sos_id).order_by(LocationUpdate.timestamp.asc()).all()
    return jsonify([u.to_dict() for u in updates]), 200

# --- Shelter Routes ---
@app.route('/api/shelters', methods=['GET'])
def get_shelters():
    """Get all shelters, optionally sorted by distance from given lat/lng."""
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)

    shelters = Shelter.query.all()
    result = []
    for s in shelters:
        d = s.to_dict()
        if lat is not None and lng is not None:
            d['distance_km'] = haversine(lat, lng, s.latitude, s.longitude)
        result.append(d)

    # Sort by distance and filter within 5km if coordinates provided
    if lat is not None and lng is not None:
        result = [r for r in result if r['distance_km'] <= 5.0]
        result.sort(key=lambda x: x['distance_km'])

    return jsonify(result), 200

@app.route('/api/shelters', methods=['POST'])
@jwt_required()
def add_shelter():
    """Add a new safe place/shelter."""
    data = request.json
    new_shelter = Shelter(
        name=data.get('name', 'Citizen Marked Safe Place'),
        latitude=data.get('lat'),
        longitude=data.get('lng'),
        capacity=data.get('capacity', 50),
        current_occupancy=0,
        has_medical=data.get('has_medical', False),
        has_food=data.get('has_food', False),
        contact_phone=data.get('contact_phone', '')
    )
    db.session.add(new_shelter)
    db.session.commit()
    return jsonify(new_shelter.to_dict()), 201

# --- Admin Routes ---
@app.route('/api/stats', methods=['GET'])
@jwt_required()
def get_stats():
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'admin':
        return jsonify({'message': 'Unauthorized'}), 403
        
    total_requests = SOSRequest.query.count()
    pending = SOSRequest.query.filter_by(status='pending').count()
    in_progress = SOSRequest.query.filter_by(status='in-progress').count()
    resolved = SOSRequest.query.filter_by(status='resolved').count()
    
    return jsonify({
        'total': total_requests,
        'pending': pending,
        'in_progress': in_progress,
        'resolved': resolved
    }), 200

# --- Risk Assessment Engine ---
def get_weather_data(lat, lon):
    """Fetch real weather data from OpenWeatherMap, fallback to simulation."""
    api_key = app.config.get('OPENWEATHER_API_KEY', '')
    if api_key:
        try:
            url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={api_key}&units=metric"
            resp = http_requests.get(url, timeout=5).json()
            # cod is returned as int 200 by OWM, not string
            if str(resp.get('cod')) == '200':
                return {
                    'temp': resp['main']['temp'],
                    'humidity': resp['main']['humidity'],
                    'wind': resp['wind']['speed'],
                    'rain': resp.get('rain', {}).get('1h', 0),
                    'desc': resp['weather'][0]['description'] if resp.get('weather') else 'N/A',
                    'source': 'openweathermap'
                }
            else:
                print(f"[WeatherAPI] Error response: {resp.get('message', 'Unknown error')} (cod={resp.get('cod')})") 
        except Exception as e:
            print(f"[WeatherAPI] Request failed: {e}")
    # Simulated weather based on location hash for consistent demo results
    import hashlib
    seed = int(hashlib.md5(f"{lat:.2f},{lon:.2f}".encode()).hexdigest()[:8], 16)
    import random
    rng = random.Random(seed + int(datetime.utcnow().timestamp() // 600))
    return {
        'temp': round(rng.uniform(25, 48), 1),
        'humidity': round(rng.uniform(40, 95), 1),
        'wind': round(rng.uniform(2, 25), 1),
        'rain': round(rng.choice([0, 0, 0, 5, 20, 50, 80, 120]) + rng.uniform(0, 10), 1),
        'desc': rng.choice(['clear sky', 'few clouds', 'scattered clouds', 'heavy rain', 'thunderstorm', 'light rain', 'overcast clouds']),
        'source': 'simulated'
    }

def calculate_risk(rain, temp, wind, humidity, sos_count_nearby):
    """Rule-based risk engine combining weather and SOS density."""
    risks = []
    # Flood risk
    if rain > 100:
        risks.append(("HIGH", "Flood Risk", "Heavy rainfall detected. Move to higher ground immediately."))
    elif rain > 50:
        risks.append(("MEDIUM", "Flood Warning", "Moderate rainfall. Stay alert for flooding."))
    # Heatwave
    if temp > 45:
        risks.append(("HIGH", "Heatwave Risk", "Extreme heat detected. Stay hydrated and indoors."))
    elif temp > 40:
        risks.append(("MEDIUM", "Heat Advisory", "High temperature. Avoid prolonged outdoor exposure."))
    # Storm
    if wind > 20:
        risks.append(("HIGH", "Storm Risk", "High winds detected. Seek shelter immediately."))
    elif wind > 15:
        risks.append(("MEDIUM", "Wind Advisory", "Strong winds expected. Secure loose objects."))
    # Combined severe
    if rain > 80 and wind > 15:
        risks.append(("HIGH", "Severe Storm", "Heavy rain with strong winds. Take immediate shelter."))
    # SOS density
    if sos_count_nearby > 50:
        risks.append(("CRITICAL", "High Emergency Zone", "Extremely high SOS activity. Area is in crisis."))
    elif sos_count_nearby > 20:
        risks.append(("HIGH", "Emergency Cluster", "High SOS concentration detected in your area."))
    elif sos_count_nearby > 5:
        risks.append(("MEDIUM", "Elevated Activity", "Multiple SOS requests reported nearby."))

    if not risks:
        return "LOW", "Normal Conditions", "No significant threats detected. Stay safe."

    # Return the highest severity
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    risks.sort(key=lambda r: order.get(r[0], 3))
    return risks[0]

@app.route('/api/risk', methods=['POST'])
def assess_risk():
    """Assess risk for a given location using weather + SOS data."""
    data = request.json
    lat = data.get('lat', 28.61)
    lon = data.get('lon', 77.23)

    weather = get_weather_data(lat, lon)

    # Count nearby SOS in last 24h (within ~5km)
    recent = datetime.utcnow() - timedelta(hours=24)
    all_sos = SOSRequest.query.filter(SOSRequest.timestamp >= recent, SOSRequest.status != 'resolved').all()
    nearby_count = sum(1 for s in all_sos if haversine(lat, lon, s.latitude, s.longitude) <= 5)

    level, rtype, msg = calculate_risk(weather['rain'], weather['temp'], weather['wind'], weather['humidity'], nearby_count)

    # Store in DB
    entry = RiskData(
        latitude=lat, longitude=lon, risk_level=level, risk_type=rtype, message=msg,
        temperature=weather['temp'], humidity=weather['humidity'],
        wind_speed=weather['wind'], rainfall=weather['rain'], weather_desc=weather['desc']
    )
    db.session.add(entry)
    db.session.commit()

    return jsonify({
        'risk_level': level, 'risk_type': rtype, 'message': msg,
        'weather': weather, 'sos_nearby': nearby_count, 'timestamp': entry.timestamp.isoformat()
    }), 200

@app.route('/api/risk/history', methods=['GET'])
@jwt_required()
def risk_history():
    """Get risk assessment history for admin analytics."""
    limit = request.args.get('limit', 50, type=int)
    entries = RiskData.query.order_by(RiskData.timestamp.desc()).limit(limit).all()
    return jsonify([e.to_dict() for e in entries]), 200

# --- Broadcast Alerts Routes ---
@app.route('/api/alerts', methods=['POST'])
@jwt_required()
def create_broadcast_alert():
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'admin':
        return jsonify({'message': 'Only admins can create broadcast alerts'}), 403

    data = request.json
    message = data.get('message')
    if not message:
        return jsonify({'message': 'Message is required'}), 400

    alert = BroadcastAlert(
        message=message,
        area=data.get('area'),
        risk_level=data.get('risk_level', 'HIGH')
    )
    db.session.add(alert)
    db.session.commit()

    # Emit WebSocket event
    socketio.emit('broadcast_alert', alert.to_dict())

    return jsonify(alert.to_dict()), 201

@app.route('/api/alerts', methods=['GET'])
def get_broadcast_alerts():
    limit = request.args.get('limit', 20, type=int)
    alerts = BroadcastAlert.query.order_by(BroadcastAlert.timestamp.desc()).limit(limit).all()
    return jsonify([a.to_dict() for a in alerts]), 200


@app.route('/api/sos/<int:sos_id>/confirm', methods=['PUT'])
@jwt_required()
def confirm_resolution(sos_id):
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'citizen':
        return jsonify({'message': 'Only citizens can confirm resolution'}), 403
    req = SOSRequest.query.get_or_404(sos_id)
    if req.user_id != current_user['id']:
        return jsonify({'message': 'Unauthorized'}), 403
    if not req.resolution_requested:
        return jsonify({'message': 'Resolution not requested'}), 400
    # Update resolution flags
    req.resolution_requested = False
    req.resolution_confirmed = True
    req.status = 'resolved'
    db.session.commit()
    # Log entry
    log = SOSLog(
        sos_id=req.id,
        status='resolved',
        message='Citizen confirmed resolution. SOS marked as resolved.'
    )
    db.session.add(log)
    db.session.commit()
    # Emit update
    socketio.emit('sos_updated', req.to_dict())
    return jsonify(req.to_dict()), 200

@app.route('/api/sos/<int:sos_id>/decline', methods=['PUT'])
@jwt_required()
def decline_resolution(sos_id):
    current_user = json.loads(get_jwt_identity())
    if current_user['role'] != 'citizen':
        return jsonify({'message': 'Only citizens can decline resolution'}), 403
    req = SOSRequest.query.get_or_404(sos_id)
    if req.user_id != current_user['id']:
        return jsonify({'message': 'Unauthorized'}), 403
    if not req.resolution_requested:
        return jsonify({'message': 'Resolution not requested'}), 400
    
    # Update resolution flags
    req.resolution_requested = False
    db.session.commit()
    
    # Log entry
    log = SOSLog(
        sos_id=req.id,
        status='in-progress',
        message='Citizen declined resolution. SOS request remains active.'
    )
    db.session.add(log)
    db.session.commit()
    
    # Emit update
    socketio.emit('sos_updated', req.to_dict())
    return jsonify(req.to_dict()), 200

# --- Nearby Volunteers Endpoint ---
@app.route('/api/volunteers/nearby', methods=['GET'])
def get_nearby_volunteers():
    """Return online volunteers within 50km of given coordinates."""
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    if lat is None or lng is None:
        return jsonify([]), 200
    
    nearby = []
    for vid, info in list(online_volunteers.items()):
        dist = haversine(lat, lng, info['lat'], info['lng'])
        if dist <= 50:
            nearby.append({
                'volunteer_id': vid,
                'name': info.get('name', ''),
                'lat': info['lat'],
                'lng': info['lng'],
                'distance_km': dist
            })
    nearby.sort(key=lambda x: x['distance_km'])
    return jsonify(nearby), 200


# --- Cascading Dispatch Engine ---
def trigger_cascading_dispatch(sos_id):
    """Find the closest eligible volunteer and ring them with a 20-second deadline."""
    with app.app_context():
        req = SOSRequest.query.get(sos_id)
        if not req or req.status != 'pending':
            return
        
        # Parse already-attempted volunteer IDs
        attempted = set()
        if req.dispatch_attempted_ids:
            attempted = set(int(x) for x in req.dispatch_attempted_ids.split(',') if x)
        
        # Find closest eligible online volunteer
        candidates = []
        for vid, info in list(online_volunteers.items()):
            if vid in attempted:
                continue
            dist = haversine(req.latitude, req.longitude, info['lat'], info['lng'])
            if dist <= 50:  # Only within 50km
                candidates.append((vid, dist, info))
        
        candidates.sort(key=lambda x: x[1])
        
        if not candidates:
            # No more volunteers to ring — leave as pending for manual accept
            req.current_dispatch_volunteer_id = None
            db.session.commit()
            socketio.emit('sos_updated', req.to_dict())
            return
        
        # Ring the closest volunteer
        target_id, target_dist, target_info = candidates[0]
        req.current_dispatch_volunteer_id = target_id
        db.session.commit()
        
        # Emit targeted ring to specific volunteer
        socketio.emit('sos_dispatch_ring', {
            'sos_id': req.id,
            'volunteer_target_id': target_id,
            'citizen_name': req.user.name if req.user else 'Citizen',
            'citizen_phone': req.user.phone if req.user else '',
            'types': req.type.split(',') if req.type else [],
            'priority': req.priority,
            'description': req.description or '',
            'location': {'lat': req.latitude, 'lng': req.longitude},
            'distance_km': round(target_dist, 2),
            'deadline_seconds': 20
        })
        
        # Log the dispatch attempt
        log = SOSLog(
            sos_id=req.id,
            status='pending',
            message=f"Dispatch ring sent to volunteer {target_info.get('name', f'#{target_id}')} ({round(target_dist, 2)} km away)"
        )
        db.session.add(log)
        db.session.commit()
        socketio.emit('sos_updated', req.to_dict())
        
        # Schedule timeout for cascade
        def on_timeout():
            with app.app_context():
                req_check = SOSRequest.query.get(sos_id)
                if req_check and req_check.status == 'pending' and req_check.current_dispatch_volunteer_id == target_id:
                    # Add to attempted list
                    attempted_list = [x for x in (req_check.dispatch_attempted_ids or '').split(',') if x]
                    attempted_list.append(str(target_id))
                    req_check.dispatch_attempted_ids = ','.join(attempted_list)
                    req_check.current_dispatch_volunteer_id = None
                    db.session.commit()
                    
                    log = SOSLog(
                        sos_id=sos_id,
                        status='pending',
                        message=f"Volunteer {target_info.get('name', f'#{target_id}')} did not respond. Cascading to next..."
                    )
                    db.session.add(log)
                    db.session.commit()
                    
                    # Notify the timed-out volunteer
                    socketio.emit('sos_dispatch_timeout', {'sos_id': sos_id, 'volunteer_target_id': target_id})
                    socketio.emit('sos_updated', req_check.to_dict())
                    
                    # Cascade to next
                    trigger_cascading_dispatch(sos_id)
        
        # Cancel existing timer if any
        if sos_id in dispatch_timers:
            dispatch_timers[sos_id].cancel()
        
        timer = threading.Timer(20.0, on_timeout)
        dispatch_timers[sos_id] = timer
        timer.start()


# --- Decline Dispatch Endpoint ---
@app.route('/api/sos/<int:sos_id>/decline_dispatch', methods=['POST'])
@jwt_required()
def decline_dispatch(sos_id):
    """Volunteer explicitly declines a dispatch ring, triggering the next cascade."""
    current_user = json.loads(get_jwt_identity())
    req = SOSRequest.query.get_or_404(sos_id)
    
    if req.current_dispatch_volunteer_id != current_user['id']:
        return jsonify({'message': 'You are not the current dispatch target'}), 400
    
    # Cancel the timer
    if sos_id in dispatch_timers:
        dispatch_timers[sos_id].cancel()
        del dispatch_timers[sos_id]
    
    # Add to attempted list
    attempted_list = [x for x in (req.dispatch_attempted_ids or '').split(',') if x]
    attempted_list.append(str(current_user['id']))
    req.dispatch_attempted_ids = ','.join(attempted_list)
    req.current_dispatch_volunteer_id = None
    
    volunteer = User.query.get(current_user['id'])
    log = SOSLog(
        sos_id=req.id,
        status='pending',
        message=f"Volunteer {volunteer.name if volunteer else current_user['id']} declined. Cascading to next..."
    )
    db.session.add(log)
    db.session.commit()
    
    socketio.emit('sos_updated', req.to_dict())
    
    # Trigger next cascade
    trigger_cascading_dispatch(sos_id)
    
    return jsonify({'message': 'Declined, cascading to next volunteer'}), 200


# --- Socket.IO Event Handlers ---
@socketio.on('volunteer_location_update')
def handle_volunteer_location(data):
    """Volunteer sends their live location every 10 seconds."""
    vol_id = data.get('volunteer_id')
    if vol_id:
        online_volunteers[vol_id] = {
            'lat': data.get('lat'),
            'lng': data.get('lng'),
            'sid': request.sid,
            'name': data.get('name', '')
        }
        # Broadcast to all clients for live map updates
        socketio.emit('volunteer_location_broadcast', {
            'volunteer_id': vol_id,
            'lat': data.get('lat'),
            'lng': data.get('lng'),
            'name': data.get('name', '')
        })


@socketio.on('disconnect')
def handle_disconnect():
    """Remove volunteer from online pool on disconnect."""
    to_remove = [vid for vid, info in online_volunteers.items() if info.get('sid') == request.sid]
    for vid in to_remove:
        del online_volunteers[vid]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        allow_unsafe_werkzeug=True
    )