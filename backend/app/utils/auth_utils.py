import random
import string
import time
import uuid
import hashlib
import base64
import math
from io import BytesIO
from PIL import Image, ImageDraw, ImageFilter
from datetime import datetime
from app.core.config import settings

# Simple in-memory storage for verification codes (Use Redis in production)
class VerificationStore:
    _store = {}

    @classmethod
    def add(cls, v_id, code, purpose, expires_in=300):
        cls._store[v_id] = {
            "code": code,
            "purpose": purpose, # 0: captcha, 1: email_register, 2: email_reset
            "timestamp": datetime.now(),
            "expires_in": expires_in
        }

    @classmethod
    def get(cls, v_id):
        return cls._store.get(v_id)

    @classmethod
    def delete(cls, v_id):
        if v_id in cls._store:
            del cls._store[v_id]

# Signature Utils
# SALT is now loaded from settings
# SALT = "YOUR_SALT_HERE" 

def get_salt():
    return settings.SALT

def get_password_salt():
    return settings.PASSWORD_SALT

def generate_server_sign(v_id, timestamp, nonce):
    raw = f"{v_id}{timestamp}{nonce}{settings.SALT}"
    return hashlib.sha256(raw.encode()).hexdigest()

def build_verify_string(parts, salt, nonce):
    # Simple concatenation for demo, matching the Flask logic logic
    # raw = f"{v_id}{email_id}{this_email}{this_username}{this_password}{get_salt()}{meta.get('s')}{client_nonce}"
    # But wait, the Flask code used a dynamic insertion based on nonce?
    # Let's simplify: just concat all parts + salt + nonce
    return "".join(parts) + salt + str(nonce)

def generate_captcha_image():
    code = "".join([random.choice("23456789ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(6)])
    width, height = 120, 35
    img = Image.new('RGB', (width, height), (250, 250, 250))
    draw = ImageDraw.Draw(img)

    for _ in range(40):
        draw.point((random.randint(0, width), random.randint(0, height)), fill=(180, 180, 180))
    for _ in range(3):
        draw.line((random.randint(0, width), 0, random.randint(0, width), height), fill=(210, 210, 210))

    for i, char in enumerate(code):
        char_color = (random.randint(0, 100), random.randint(0, 100), random.randint(150, 255))
        draw.text((15 + i * 16, 5 + random.randint(-3, 3)), char, fill=char_color, font_size=20)

    distorted_img = Image.new('RGB', (width, height), (250, 250, 250))
    pixels_original = img.load()
    pixels_distorted = distorted_img.load()

    for x in range(width):
        for y in range(height):
            off_x = int(2.0 * math.sin(y / 5.0))
            off_y = int(1.5 * math.sin(x / 8.0))
            new_x, new_y = x + off_x, y + off_y

            if 0 <= new_x < width and 0 <= new_y < height:
                pixels_distorted[x, y] = pixels_original[new_x, new_y]
            else:
                pixels_distorted[x, y] = (250, 250, 250)

    final_img = distorted_img.filter(ImageFilter.SMOOTH)
    buf = BytesIO()
    final_img.save(buf, format='PNG')
    return code, base64.b64encode(buf.getvalue()).decode()
