# Artist Platform

Bu loyiha ikki qismdan iborat:

- `frontend` - Vite + React interfeys
- `backend` - FastAPI yordamida rasmni sketch ko'rinishiga o'tkazuvchi API

## Setup

Tozalashdan keyin dependency'larni qayta o'rnatish uchun root papkada quyidagini ishga tushiring:

```powershell
.\setup.ps1
```

Script `npm` va `python` mavjudligini tekshiradi va muammo bo'lsa aniq xabar beradi.

## Ishga tushirish

Root papkadan quyidagini ishga tushiring:

```powershell
.\start-dev.ps1
```

Script ikkita alohida PowerShell oynasi ochadi:

- frontend: `http://localhost:5173`
- backend: `http://localhost:8000`

## Qo'lda ishga tushirish

Backend:

```powershell
cd backend
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm run dev
```

## Frontend API sozlamasi

`frontend/.env.example` mavjud. Agar backend boshqa host yoki portda ishlasa, `frontend/.env` yarating:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Agar bu env berilmasa, dev rejimda Vite proxy `/api` so'rovlarini avtomatik `http://localhost:8000` ga yuboradi.
