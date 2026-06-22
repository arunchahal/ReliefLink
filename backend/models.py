from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False) # 'citizen', 'volunteer', 'admin'
    phone = db.Column(db.String(20), unique=True, nullable=False)
    # Password hashing could be added here, but for now we'll keep it simple
    password = db.Column(db.String(255), nullable=False)
    is_safe = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'role': self.role,
            'phone': self.phone,
            'is_safe': self.is_safe
        }

class SOSRequest(db.Model):
    __tablename__ = 'sos_requests'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    type = db.Column(db.String(200), nullable=False) # Comma-separated: 'food,medical,rescue'
    priority = db.Column(db.String(20), default='medium') # 'low', 'medium', 'critical'
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    description = db.Column(db.Text, nullable=True)
    volunteer_eta = db.Column(db.Integer, nullable=True)  # ETA in minutes
    volunteer_distance_km = db.Column(db.Float, nullable=True)  # Distance in km
    assigned_volunteer_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    # Volunteer assigned to handle the SOS
    volunteer = db.relationship('User', foreign_keys=[assigned_volunteer_id])
    status = db.Column(db.String(20), default='pending') # 'pending', 'in-progress', 'resolved'
    resolution_requested = db.Column(db.Boolean, default=False)
    resolution_confirmed = db.Column(db.Boolean, default=False)
    current_dispatch_volunteer_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    dispatch_attempted_ids = db.Column(db.Text, default='') # Comma-separated: '2,3'
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', foreign_keys=[user_id])
    # Removed duplicate volunteer relationship

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.name if self.user else None,
            'user_phone': self.user.phone if self.user else None,
            'type': self.type,
            'types': self.type.split(',') if self.type else [],
            'location': {
                'lat': self.latitude,
                'lng': self.longitude
            },
            'volunteer_eta': self.volunteer_eta,
            'volunteer_distance_km': self.volunteer_distance_km,
            'description': self.description,
            'status': self.status,
            'assigned_volunteer': self.assigned_volunteer_id,
            'volunteer_name': self.volunteer.name if self.volunteer else None,
            'resolution_requested': self.resolution_requested,
            'resolution_confirmed': self.resolution_confirmed,
            'current_dispatch_volunteer': self.current_dispatch_volunteer_id,
            'dispatch_attempted_ids': [int(x) for x in self.dispatch_attempted_ids.split(',') if x] if self.dispatch_attempted_ids else [],
            'timestamp': self.timestamp.isoformat(),
            'timeline': [log.to_dict() for log in sorted(self.logs, key=lambda x: x.timestamp)] if hasattr(self, 'logs') and self.logs else []
        }

class LocationUpdate(db.Model):
    __tablename__ = 'location_updates'
    id = db.Column(db.Integer, primary_key=True)
    sos_id = db.Column(db.Integer, db.ForeignKey('sos_requests.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    sos = db.relationship('SOSRequest', backref='location_updates')

    def to_dict(self):
        return {
            'id': self.id,
            'sos_id': self.sos_id,
            'user_id': self.user_id,
            'lat': self.latitude,
            'lng': self.longitude,
            'timestamp': self.timestamp.isoformat()
        }

class Shelter(db.Model):
    __tablename__ = 'shelters'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    capacity = db.Column(db.Integer, default=100)
    current_occupancy = db.Column(db.Integer, default=0)
    has_medical = db.Column(db.Boolean, default=False)
    has_food = db.Column(db.Boolean, default=True)
    contact_phone = db.Column(db.String(20), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'lat': self.latitude,
            'lng': self.longitude,
            'capacity': self.capacity,
            'current_occupancy': self.current_occupancy,
            'available_spots': self.capacity - self.current_occupancy,
            'has_medical': self.has_medical,
            'has_food': self.has_food,
            'contact_phone': self.contact_phone
        }

class Resource(db.Model):
    __tablename__ = 'resources'
    id = db.Column(db.Integer, primary_key=True)
    volunteer_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    food_kits = db.Column(db.Integer, default=0)
    medical_kits = db.Column(db.Integer, default=0)
    vehicles = db.Column(db.Integer, default=0)

    volunteer = db.relationship('User', foreign_keys=[volunteer_id])

    def to_dict(self):
        return {
            'id': self.id,
            'volunteer_id': self.volunteer_id,
            'food_kits': self.food_kits,
            'medical_kits': self.medical_kits,
            'vehicles': self.vehicles
        }

class RiskData(db.Model):
    __tablename__ = 'risk_data'
    id = db.Column(db.Integer, primary_key=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    risk_level = db.Column(db.String(20), nullable=False)  # 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    risk_type = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=True)
    temperature = db.Column(db.Float, nullable=True)
    humidity = db.Column(db.Float, nullable=True)
    wind_speed = db.Column(db.Float, nullable=True)
    rainfall = db.Column(db.Float, nullable=True)
    weather_desc = db.Column(db.String(200), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'risk_level': self.risk_level,
            'risk_type': self.risk_type,
            'message': self.message,
            'temperature': self.temperature,
            'humidity': self.humidity,
            'wind_speed': self.wind_speed,
            'rainfall': self.rainfall,
            'weather_desc': self.weather_desc,
            'timestamp': self.timestamp.isoformat()
        }

class SOSLog(db.Model):
    __tablename__ = 'sos_logs'
    id = db.Column(db.Integer, primary_key=True)
    sos_id = db.Column(db.Integer, db.ForeignKey('sos_requests.id'), nullable=False)
    status = db.Column(db.String(20), nullable=False) # 'pending', 'in-progress', 'resolved'
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    message = db.Column(db.String(255), nullable=True)

    sos = db.relationship('SOSRequest', backref=db.backref('logs', lazy=True, cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            'id': self.id,
            'sos_id': self.sos_id,
            'status': self.status,
            'timestamp': self.timestamp.isoformat(),
            'message': self.message
        }

class BroadcastAlert(db.Model):
    __tablename__ = 'broadcast_alerts'
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.Text, nullable=False)
    area = db.Column(db.String(100), nullable=True)
    risk_level = db.Column(db.String(20), default='HIGH') # 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'message': self.message,
            'area': self.area,
            'risk_level': self.risk_level,
            'timestamp': self.timestamp.isoformat()
        }
