import base64
import json
import os
from pathlib import Path
from uuid import uuid4

import aiofiles
import cv2
import numpy as np
import sqlite3
import secrets
import hashlib
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

SAVES_DIR = UPLOAD_DIR / "saves"
SAVES_DIR.mkdir(exist_ok=True)

DB_PATH = BASE_DIR / "database.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            salt TEXT
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        conn.commit()

init_db()

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def get_current_user(authorization: str = Header(None), db: sqlite3.Connection = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Avtorizatsiya tokeni topilmadi")
    token = authorization.split(" ")[1]
    
    cur = db.execute("SELECT user_id FROM sessions WHERE token = ?", (token,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Yaroqsiz token (Iltimos, qayta kiring)")
        
    user_cur = db.execute("SELECT id, username FROM users WHERE id = ?", (row["user_id"],))
    user = user_cur.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Foydalanuvchi topilmadi")
        
    return dict(user)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def to_data_url(image):
    success, buffer = cv2.imencode(".jpg", image)
    if not success:
        raise HTTPException(status_code=500, detail="Rasmni encode qilishda xatolik")
    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"


def validate_image_upload(file: UploadFile, contents: bytes) -> None:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Faqat rasm fayllari qabul qilinadi")

    if not contents:
        raise HTTPException(status_code=400, detail="Bo'sh fayl yuborildi")

async def read_file_with_limit(file: UploadFile, max_size: int = 15 * 1024 * 1024) -> bytes:
    contents = bytearray()
    while chunk := await file.read(1024 * 1024):
        contents.extend(chunk)
        if len(contents) > max_size:
            raise HTTPException(status_code=413, detail=f"Fayl hajmi juda katta (Max {max_size//(1024*1024)}MB limit)")
    return bytes(contents)



def build_upload_url(request: Request, filename: str) -> str:
    return str(request.url_for("uploads", path=filename))


def process_edges(edge_img, kernel_size=(2, 2), blur_kernel=None):
    working = edge_img
    if blur_kernel is not None:
        working = cv2.GaussianBlur(working, blur_kernel, 0)
    inverted = cv2.bitwise_not(working)
    kernel = np.ones(kernel_size, np.uint8)
    dilated = cv2.erode(inverted, kernel, iterations=1)
    return dilated


def build_canny_steps(gray):
    blur1 = cv2.GaussianBlur(gray, (11, 11), 0)
    blur2 = cv2.GaussianBlur(gray, (5, 5), 0)
    edges1 = cv2.Canny(blur1, 80, 200)
    edges2 = cv2.Canny(blur2, 50, 150)
    edges3 = cv2.Canny(gray, 30, 150)
    return [
        process_edges(edges1),
        process_edges(edges2),
        process_edges(edges3),
    ]


def build_soft_steps(gray):
    base = cv2.GaussianBlur(gray, (17, 17), 0)
    edges1 = cv2.Canny(base, 35, 100)
    edges2 = cv2.Canny(cv2.GaussianBlur(gray, (9, 9), 0), 25, 85)
    edges3 = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (5, 5), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,
        2,
    )
    edges3 = cv2.bitwise_not(edges3)
    return [
        process_edges(edges1, blur_kernel=(5, 5)),
        process_edges(edges2, blur_kernel=(3, 3)),
        process_edges(edges3, kernel_size=(1, 1)),
    ]


def build_portrait_steps(gray):
    detail = cv2.bilateralFilter(gray, 9, 50, 50)
    edges1 = cv2.Canny(cv2.GaussianBlur(detail, (9, 9), 0), 45, 120)
    edges2 = cv2.Canny(detail, 35, 105)
    laplacian = cv2.Laplacian(detail, cv2.CV_8U, ksize=3)
    edges3 = cv2.threshold(laplacian, 18, 255, cv2.THRESH_BINARY)[1]
    return [
        process_edges(edges1, kernel_size=(2, 2)),
        process_edges(edges2, kernel_size=(2, 2)),
        process_edges(edges3, kernel_size=(1, 1)),
    ]


def generate_steps(gray, style):
    if style == "soft":
        return build_soft_steps(gray)
    if style == "portrait":
        return build_portrait_steps(gray)
    return build_canny_steps(gray)


@app.get("/api/health")
async def healthcheck():
    return {
        "status": "ok",
        "service": "artist-platform-backend",
        "origins": allowed_origins,
    }


async def save_uploaded_file(file: UploadFile, request: Request):
    contents = await read_file_with_limit(file)
    validate_image_upload(file, contents)

    extension = Path(file.filename or "upload").suffix or ".png"
    safe_name = f"{uuid4().hex}{extension.lower()}"
    destination = UPLOAD_DIR / safe_name
    
    async with aiofiles.open(destination, "wb") as f:
        await f.write(contents)

    return {
        "success": True,
        "filename": safe_name,
        "originalName": file.filename,
        "contentType": file.content_type,
        "url": build_upload_url(request, safe_name),
    }



@app.post("/api/upload")
async def upload_image(request: Request, file: UploadFile = File(...)):
    return await save_uploaded_file(file, request)


@app.post("/api/sketch")
async def create_sketch(file: UploadFile = File(...), style: str = Form("canny")):
    contents = await read_file_with_limit(file)
    validate_image_upload(file, contents)

    if style not in {"canny", "soft", "portrait"}:
        raise HTTPException(status_code=400, detail="Noto'g'ri style tanlandi")

    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Rasmni o'qib bo'lmadi")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    steps = generate_steps(gray, style)

    encoded_steps = [to_data_url(step) for step in steps]

    return {
        "style": style,
        "sketch": encoded_steps[-1],
        "steps": encoded_steps,
        "initial_drawing": None,
    }

@app.post("/api/register")
async def register(payload: dict = Body(...), db: sqlite3.Connection = Depends(get_db)):
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not username or not password or len(username) < 3 or len(password) < 4:
        raise HTTPException(status_code=400, detail="Username kamida 3ta harf, Parol 4ta xarif bo'lishi shart")
        
    try:
        salt = secrets.token_hex(16)
        pwd_hash = hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
        cursor = db.cursor()
        cursor.execute("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", (username, pwd_hash, salt))
        user_id = cursor.lastrowid
        db.commit()
        
        token = secrets.token_hex(32)
        db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        db.commit()
        
        return {"success": True, "token": token, "username": username, "message": "Muvaffaqiyatli ro'yxatdan o'tdingiz!"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Bu foydalanuvchi nomi afsuski band. Boshqa ism tanlang.")

@app.post("/api/login")
async def login(payload: dict = Body(...), db: sqlite3.Connection = Depends(get_db)):
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    
    cur = db.execute("SELECT id, password_hash, salt FROM users WHERE username = ?", (username,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=400, detail="Login yoki parol xato")
        
    pwd_hash = hashlib.sha256((password + user["salt"]).encode('utf-8')).hexdigest()
    if pwd_hash != user["password_hash"]:
        raise HTTPException(status_code=400, detail="Login yoki parol xato")
        
    token = secrets.token_hex(32)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"]))
    db.commit()
    
    return {"success": True, "token": token, "username": username}

@app.post("/api/logout")
async def logout(authorization: str = Header(None), db: sqlite3.Connection = Depends(get_db)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
    return {"success": True}

@app.get("/api/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"success": True, "user": {"id": user["id"], "username": user["username"]}}

@app.get("/api/projects")
async def list_projects(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY id DESC", (user["id"],))
    projects = [dict(row) for row in cur.fetchall()]
    return {"success": True, "projects": projects}

@app.get("/api/projects/{project_id}")
async def get_project(project_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("SELECT name, data FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"]))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Loyiha topilmadi")
    try:
        data = json.loads(row["data"])
    except json.JSONDecodeError:
        data = {}
    return {"success": True, "name": row["name"], "data": data}

@app.post("/api/projects")
async def save_project(request: Request, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    body_bytes = bytearray()
    async for chunk in request.stream():
        body_bytes.extend(chunk)
        if len(body_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Payload juda katta (Max 20MB)")
            
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Noto'g'ri JSON format")
        
    name = payload.get("name")
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Loyiha nomini kiriting")
        
    data_str = json.dumps(payload.get("data", {}), ensure_ascii=False)
    
    cur = db.execute("SELECT id FROM projects WHERE name = ? AND user_id = ?", (name, user["id"]))
    row = cur.fetchone()
    if row:
        db.execute("UPDATE projects SET data = ? WHERE id = ?", (data_str, row["id"]))
    else:
        db.execute("INSERT INTO projects (user_id, name, data) VALUES (?, ?, ?)", (user["id"], name, data_str))
    db.commit()
    return {"success": True, "message": "Loyiha muvaffaqiyatli bulutga saqlandi!"}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("SELECT id FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"]))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="Loyiha topilmadi")
        
    db.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"]))
    db.commit()
    return {"success": True, "message": "Loyiha o'chirildi"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
