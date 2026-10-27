"""
main.py — The FastAPI application. All API routes live here.

What is FastAPI?
  A modern Python framework for building APIs. You write Python functions
  and it automatically turns them into HTTP endpoints that the frontend
  can call. It also generates a live interactive API documentation page
  at http://localhost:8000/docs — very useful for testing!

Features:
  1. GreenCampus AI Issue Reporting:
     - GET  /api/health
     - GET  /api/tickets
     - POST /api/tickets (AI auto-classification)
     - POST /api/ai/classify (AI triage preview)
     - PATCH /api/tickets/{id}/status
     - GET  /api/dashboard/summary
  2. Campus Connect:
     - POST /api/connect/profiles
     - GET  /api/connect/profiles
     - GET  /api/connect/profiles/{profile_id}
     - POST /api/connect/availability
     - POST /api/connect/availability/{profile_id}/cancel
     - GET  /api/connect/available
     - POST /api/connect/requests (Step 2: Send connection request)
     - GET  /api/connect/requests/pending (Step 2: Incoming pending requests)
     - GET  /api/connect/requests/sent (Step 2: Outgoing pending requests)
     - GET  /api/connect/requests/status-map (Step 2: Connection status map)
     - PATCH /api/connect/requests/{request_id} (Step 2: Accept or reject request)
     - GET  /api/connect/connections (Step 2: Mutual accepted connections)
"""

import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from database import create_tables, get_connection
from models import (
    TicketCreate,
    TicketStatusUpdate,
    TicketOut,
    DashboardSummary,
    AIClassifyRequest,
    GeminiClassification,
    StudentProfileCreate,
    StudentProfileOut,
    AvailabilityCreate,
    ActiveAvailabilityOut,
    ActiveStudentOut,
    ConnectionRequestCreate,
    ConnectionRequestAction,
    ConnectionRequestOut,
    ConnectionOut,
    PeerMessageCreate,
    PeerMessageOut,
    DirectConversationOut,
    ChatRequest,
    ChatResponse,
)
from seed import seed_database
from ai_service import classify_ticket, is_api_key_configured, generate_chat_reply


# ── Helpers for Campus Connect ────────────────────────────────────────────────
def parse_interests(raw_val) -> list[str]:
    """Parse JSON or comma-separated string of interests into a Python list."""
    if not raw_val:
        return []
    if isinstance(raw_val, list):
        return raw_val
    try:
        parsed = json.loads(raw_val)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return [i.strip() for i in str(raw_val).split(",") if i.strip()]


def calc_minutes_remaining(expires_at_str: str) -> int:
    """Calculate remaining minutes until an availability expires."""
    try:
        exp = datetime.strptime(expires_at_str, "%Y-%m-%d %H:%M:%S")
        diff = (exp - datetime.now()).total_seconds()
        return max(0, int(diff / 60))
    except Exception:
        return 0


def fetch_profile_by_id(conn, pid: int) -> Optional[StudentProfileOut]:
    """Helper to fetch a single profile by ID."""
    row = conn.execute("SELECT * FROM student_profiles WHERE id = ?", (pid,)).fetchone()
    if not row:
        return None
    return StudentProfileOut(
        id=row["id"],
        name=row["name"],
        department=row["department"],
        study_year=row["study_year"],
        bio=row["bio"] or "",
        interests=parse_interests(row["interests"]),
        created_at=row["created_at"],
    )


# ── Lifespan: runs on startup (and cleanup on shutdown) ───────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    from ai_service import get_ai_providers_status
    from database import get_db_info

    print("🚀 GreenCampus AI backend starting v1.3.0...")
    create_tables()
    print("  ✅ Database tables verified.")
    seed_database()
    print("  ✅ Initial seed checked.")

    db_info = get_db_info()
    print(f"  💾 Database: {db_info['type'].upper()} ({'Persistent' if db_info['persistent'] else 'Ephemeral'})")

    ai_info = get_ai_providers_status()
    print(f"  🤖 Active Primary AI: {ai_info['active_primary'].upper()}")
    print(f"     • Gemini:   {'Configured' if ai_info['gemini']['configured'] else 'Not set'} ({ai_info['gemini']['model']})")
    print(f"     • xAI Grok: {'Configured' if ai_info['grok']['configured'] else 'Not set'} ({ai_info['grok']['model']})")
    print(f"     • OpenAI:   {'Configured' if ai_info['openai']['configured'] else 'Not set'} ({ai_info['openai']['model']})")
    print(f"     • Fallback: Always Active (deterministic local rules)")

    yield
    print("🛑 GreenCampus AI backend shutting down.")


# ── App setup ──────────────────────────────────────────────────────────────────
app = FastAPI(
    title="GreenCampus AI API",
    description=(
        "Backend for GreenCampus AI — Smart campus issue reporting with "
        "resilient multi-tier AI failover (Gemini -> Grok -> OpenAI -> Rule-based), "
        "persistent database, and Campus Connect."
    ),
    version="1.3.0",
    lifespan=lifespan,
)

# ── CORS (Cross-Origin Resource Sharing) ──────────────────────────────────────
# Allows requests from Vite local dev and any verified Vercel production/preview domain
import os

_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://greencampus-ai-pi.vercel.app",
    "https://greencampus-c3vencflt-sayan-d154.vercel.app",
    "https://greencampus-jnelhrj5q-sayan-d154.vercel.app",
    "https://greencampus-7rqwg8pzl-sayan-d154.vercel.app",
]

# Allow custom domain or frontend URL from environment variable
_extra_env_origins = os.getenv("ALLOWED_ORIGINS", os.getenv("FRONTEND_URL", "")).split(",")
for _orig in _extra_env_origins:
    _clean_orig = _orig.strip()
    if _clean_orig and _clean_orig not in _ALLOWED_ORIGINS:
        _ALLOWED_ORIGINS.append(_clean_orig)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:[0-9]+)?|https://[a-zA-Z0-9_\-]+\.vercel\.app)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# ROOT & SYSTEM HEALTH ROUTES
# =============================================================================

@app.get("/", tags=["System"])
def root():
    return {
        "status": "online",
        "service": "GreenCampus AI Backend API",
        "version": "1.3.0",
        "frontend": "http://127.0.0.1:5173",
        "docs": "/docs",
        "health": "/api/health",
        "message": "GreenCampus AI Backend is active and running successfully."
    }

@app.get("/api", tags=["System"])
def api_root():
    return {
        "status": "online",
        "service": "GreenCampus AI Backend API",
        "version": "1.3.0",
        "docs": "/docs",
        "health": "/api/health"
    }


# =============================================================================
# GREENCAMPUS AI: ISSUE TICKETING ROUTES
# =============================================================================

@app.get("/api/health", tags=["System"])
def health_check():
    """Health alive check returning multi-tier AI status and database persistence."""
    from ai_service import get_ai_providers_status
    from database import get_db_info

    ai_status = get_ai_providers_status()
    db_info = get_db_info()

    return {
        "status": "ok",
        "message": "GreenCampus AI backend is running 🌿",
        "ai_engine": ai_status["active_primary"],
        "ai_providers": ai_status,
        "database": db_info,
    }


@app.get("/api/tickets", response_model=list[TicketOut], tags=["Tickets"])
def get_tickets(
    status:   Optional[str] = Query(None, description="Filter by status: Open | In Progress | Resolved"),
    priority: Optional[str] = Query(None, description="Filter by priority: High | Medium | Low"),
    category: Optional[str] = Query(None, description="Filter by category"),
):
    """Returns all campus issue tickets, newest first."""
    query = "SELECT * FROM tickets WHERE 1=1"
    params = []

    if status:
        query += " AND status = ?"
        params.append(status)
    if priority:
        query += " AND priority = ?"
        params.append(priority)
    if category:
        query += " AND category = ?"
        params.append(category)

    query += " ORDER BY created_at DESC"

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()

    return [TicketOut(**dict(row)) for row in rows]


@app.post("/api/tickets", response_model=TicketOut, status_code=201, tags=["Tickets"])
def create_ticket(ticket: TicketCreate):
    """
    Submit a new campus issue report.
    Automatically triaged and classified by Gemini AI (or fallback).
    """
    classification = classify_ticket(
        title=ticket.title,
        description=ticket.description,
        location=ticket.location,
        user_category=ticket.category,
    )

    final_category = classification.category
    final_priority = classification.priority
    final_department = classification.department

    if ticket.department and ticket.department not in ("Unassigned", ""):
        final_department = ticket.department

    ai_suggestion_text = (
        f"{classification.explanation} "
        f"Recommended Action: {classification.recommended_action}"
    )

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO tickets
              (title, description, category, location, department,
               priority, status, submitted_by, ai_suggestion, ai_explanation, ai_action)
            VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)
            """,
            (
                ticket.title,
                ticket.description,
                final_category,
                ticket.location,
                final_department,
                final_priority,
                ticket.submitted_by,
                ai_suggestion_text,
                classification.explanation,
                classification.recommended_action,
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE id = ?", (new_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="Ticket was not saved correctly.")

    return TicketOut(**dict(row))


@app.post("/api/ai/classify", response_model=GeminiClassification, tags=["AI"])
def classify_issue_preview(request: AIClassifyRequest):
    """On-demand AI classification preview endpoint."""
    return classify_ticket(
        title=request.title,
        description=request.description,
        location=request.location,
        user_category=request.category,
    )


@app.post("/api/chat", response_model=ChatResponse, tags=["AI Assistant"])
def chat_with_campus_assistant(body: ChatRequest):
    """
    Live conversational AI Assistant for GreenCampus AI (Echo).
    Supported by 4-tier error-handling fallback:
      1. Primary Free Gemini (gemini-2.5-flash / gemini-3.5)
      2. Secondary Free Gemini models (gemini-2.0-flash, gemini-1.5-flash, etc.)
      3. xAI Grok (grok-2-latest)
      4. OpenAI (gpt-4o-mini)
      5. Guaranteed local campus knowledge base
    """
    return generate_chat_reply(message=body.message, history=body.history)


@app.patch("/api/tickets/{ticket_id}/status", response_model=TicketOut, tags=["Tickets"])
def update_ticket_status(ticket_id: int, body: TicketStatusUpdate):
    """Update status of a specific ticket."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail=f"Ticket with id {ticket_id} not found.")

    with get_connection() as conn:
        conn.execute("UPDATE tickets SET status = ? WHERE id = ?", (body.status, ticket_id))
        conn.commit()
        updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()

    return TicketOut(**dict(updated))


@app.get("/api/dashboard/summary", response_model=DashboardSummary, tags=["Dashboard"])
def get_dashboard_summary():
    """Returns aggregate ticket statistics for the admin dashboard."""
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
        open_count = conn.execute("SELECT COUNT(*) FROM tickets WHERE status = 'Open'").fetchone()[0]
        in_progress = conn.execute("SELECT COUNT(*) FROM tickets WHERE status = 'In Progress'").fetchone()[0]
        resolved = conn.execute("SELECT COUNT(*) FROM tickets WHERE status = 'Resolved'" ).fetchone()[0]

        high   = conn.execute("SELECT COUNT(*) FROM tickets WHERE priority = 'High'").fetchone()[0]
        medium = conn.execute("SELECT COUNT(*) FROM tickets WHERE priority = 'Medium'").fetchone()[0]
        low    = conn.execute("SELECT COUNT(*) FROM tickets WHERE priority = 'Low'").fetchone()[0]

        category_rows = conn.execute(
            "SELECT category, COUNT(*) as count FROM tickets GROUP BY category ORDER BY count DESC"
        ).fetchall()

    by_category = {row["category"]: row["count"] for row in category_rows}

    return DashboardSummary(
        total=total,
        open=open_count,
        in_progress=in_progress,
        resolved=resolved,
        high=high,
        medium=medium,
        low=low,
        by_category=by_category,
    )


# =============================================================================
# CAMPUS CONNECT: PROFILES & REAL-TIME AVAILABILITY
# =============================================================================

@app.post("/api/connect/profiles", response_model=StudentProfileOut, status_code=201, tags=["Campus Connect"])
def create_student_profile(profile: StudentProfileCreate):
    """Create a new student profile for Campus Connect."""
    interests_json = json.dumps(profile.interests)

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO student_profiles (name, department, study_year, bio, interests)
            VALUES (?, ?, ?, ?, ?)
            """,
            (profile.name, profile.department, profile.study_year, profile.bio, interests_json),
        )
        conn.commit()
        new_id = cursor.lastrowid

        row = conn.execute("SELECT * FROM student_profiles WHERE id = ?", (new_id,)).fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create student profile.")

    return StudentProfileOut(
        id=row["id"],
        name=row["name"],
        department=row["department"],
        study_year=row["study_year"],
        bio=row["bio"] or "",
        interests=parse_interests(row["interests"]),
        created_at=row["created_at"],
    )


@app.get("/api/connect/profiles", response_model=list[StudentProfileOut], tags=["Campus Connect"])
def list_student_profiles():
    """List all student profiles registered on Campus Connect."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM student_profiles ORDER BY name ASC").fetchall()

    return [
        StudentProfileOut(
            id=row["id"],
            name=row["name"],
            department=row["department"],
            study_year=row["study_year"],
            bio=row["bio"] or "",
            interests=parse_interests(row["interests"]),
            created_at=row["created_at"],
        )
        for row in rows
    ]


@app.get("/api/connect/profiles/{profile_id}", tags=["Campus Connect"])
def get_student_profile(profile_id: int):
    """Get profile details for a student, along with their current active availability if any."""
    with get_connection() as conn:
        p_row = conn.execute("SELECT * FROM student_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not p_row:
            raise HTTPException(status_code=404, detail="Student profile not found.")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        a_row = conn.execute(
            """
            SELECT * FROM student_availabilities
            WHERE profile_id = ? AND status = 'ACTIVE' AND expires_at > ?
            ORDER BY id DESC LIMIT 1
            """,
            (profile_id, now_str),
        ).fetchone()

    profile_data = {
        "id": p_row["id"],
        "name": p_row["name"],
        "department": p_row["department"],
        "study_year": p_row["study_year"],
        "bio": p_row["bio"] or "",
        "interests": parse_interests(p_row["interests"]),
        "created_at": p_row["created_at"],
    }

    active_availability = None
    if a_row:
        active_availability = {
            "id": a_row["id"],
            "profile_id": a_row["profile_id"],
            "activity": a_row["activity"],
            "duration_minutes": a_row["duration_minutes"],
            "location_area": a_row["location_area"],
            "note": a_row["note"] or "",
            "available_from": a_row["available_from"],
            "expires_at": a_row["expires_at"],
            "minutes_remaining": calc_minutes_remaining(a_row["expires_at"]),
            "status": a_row["status"],
        }

    return {
        "profile": profile_data,
        "active_availability": active_availability,
    }


@app.post("/api/connect/availability", response_model=ActiveAvailabilityOut, status_code=201, tags=["Campus Connect"])
def broadcast_availability(avail: AvailabilityCreate):
    """
    Mark a student as available for STUDY, COFFEE, LUNCH, WALK, or CASUAL_CHAT.
    Enforces 15, 30, or 60 minute duration.
    Cancels any previous active availability for this student.
    """
    with get_connection() as conn:
        profile = conn.execute("SELECT id FROM student_profiles WHERE id = ?", (avail.profile_id,)).fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail=f"Student profile with ID {avail.profile_id} not found.")

        conn.execute(
            "UPDATE student_availabilities SET status = 'CANCELLED' WHERE profile_id = ? AND status = 'ACTIVE'",
            (avail.profile_id,),
        )

        now = datetime.now()
        avail_from = now.strftime("%Y-%m-%d %H:%M:%S")
        expires_at = (now + timedelta(minutes=avail.duration_minutes)).strftime("%Y-%m-%d %H:%M:%S")

        cur = conn.execute(
            """
            INSERT INTO student_availabilities
              (profile_id, activity, duration_minutes, location_area, note, available_from, expires_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            """,
            (
                avail.profile_id,
                avail.activity,
                avail.duration_minutes,
                avail.location_area or "Anywhere on Campus",
                avail.note or "",
                avail_from,
                expires_at,
            ),
        )
        conn.commit()
        new_id = cur.lastrowid

        row = conn.execute("SELECT * FROM student_availabilities WHERE id = ?", (new_id,)).fetchone()

    return ActiveAvailabilityOut(
        id=row["id"],
        profile_id=row["profile_id"],
        activity=row["activity"],
        duration_minutes=row["duration_minutes"],
        location_area=row["location_area"],
        note=row["note"] or "",
        available_from=row["available_from"],
        expires_at=row["expires_at"],
        minutes_remaining=calc_minutes_remaining(row["expires_at"]),
        status=row["status"],
    )


@app.post("/api/connect/availability/{profile_id}/cancel", tags=["Campus Connect"])
def cancel_availability(profile_id: int):
    """Stop broadcasting availability for a student."""
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE student_availabilities SET status = 'CANCELLED' WHERE profile_id = ? AND status = 'ACTIVE'",
            (profile_id,),
        )
        conn.commit()
        updated_count = cursor.rowcount

    return {
        "status": "ok",
        "message": f"Availability broadcast cancelled. ({updated_count} record(s) updated)",
        "profile_id": profile_id,
    }


@app.get("/api/connect/available", response_model=list[ActiveStudentOut], tags=["Campus Connect"])
def get_available_students(
    activity: Optional[str] = Query(None, description="Filter by activity: STUDY | COFFEE | LUNCH | WALK | CASUAL_CHAT"),
    interest: Optional[str] = Query(None, description="Filter by shared interest tag"),
    location_area: Optional[str] = Query(None, description="Filter by campus location area"),
):
    """
    Returns only students who have explicitly opted in and whose availability has NOT expired.
    Backend-enforced filter: status='ACTIVE' AND expires_at > now.
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    query = """
        SELECT
            a.id AS availability_id,
            a.profile_id,
            p.name,
            p.department,
            p.study_year,
            p.bio,
            p.interests,
            a.activity,
            a.duration_minutes,
            a.location_area,
            a.note,
            a.available_from,
            a.expires_at,
            a.status
        FROM student_availabilities a
        JOIN student_profiles p ON a.profile_id = p.id
        WHERE a.status = 'ACTIVE' AND a.expires_at > ?
    """
    params = [now_str]

    if activity and activity != "All":
        query += " AND a.activity = ?"
        params.append(activity)

    if location_area and location_area != "All Areas":
        query += " AND a.location_area = ?"
        params.append(location_area)

    query += " ORDER BY a.expires_at ASC"

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()

    result = []
    for row in rows:
        interests_list = parse_interests(row["interests"])

        if interest and interest != "All":
            if not any(interest.lower() == i.lower() for i in interests_list):
                continue

        minutes_rem = calc_minutes_remaining(row["expires_at"])
        if minutes_rem <= 0:
            continue

        result.append(
            ActiveStudentOut(
                availability_id=row["availability_id"],
                profile_id=row["profile_id"],
                name=row["name"],
                department=row["department"],
                study_year=row["study_year"],
                bio=row["bio"] or "",
                interests=interests_list,
                activity=row["activity"],
                duration_minutes=row["duration_minutes"],
                location_area=row["location_area"],
                note=row["note"] or "",
                available_from=row["available_from"],
                expires_at=row["expires_at"],
                minutes_remaining=minutes_rem,
                status=row["status"],
            )
        )

    return result


# =============================================================================
# CAMPUS CONNECT STEP 2: CONNECTION REQUESTS & MUTUAL CONNECTIONS
# =============================================================================

@app.post("/api/connect/requests", response_model=ConnectionRequestOut, status_code=201, tags=["Campus Connect Requests"])
def send_connection_request(payload: ConnectionRequestCreate):
    """
    Send a connection request from one student to another.
    Rules:
    1. Prevents self-requests (sender_id == receiver_id -> 400).
    2. Prevents duplicate pending requests in either direction -> 400.
    3. Prevents re-requesting if already connected -> 400.
    """
    if payload.sender_id == payload.receiver_id:
        raise HTTPException(status_code=400, detail="You cannot send a connection request to yourself.")

    with get_connection() as conn:
        # Check sender & receiver exist
        sender = conn.execute("SELECT id FROM student_profiles WHERE id = ?", (payload.sender_id,)).fetchone()
        if not sender:
            raise HTTPException(status_code=404, detail=f"Sender profile {payload.sender_id} not found.")

        receiver = conn.execute("SELECT id FROM student_profiles WHERE id = ?", (payload.receiver_id,)).fetchone()
        if not receiver:
            raise HTTPException(status_code=404, detail=f"Target student profile {payload.receiver_id} not found.")

        # Check existing connection or pending request
        existing = conn.execute(
            """
            SELECT * FROM connection_requests
            WHERE (sender_id = ? AND receiver_id = ?)
               OR (sender_id = ? AND receiver_id = ?)
            ORDER BY id DESC LIMIT 1
            """,
            (payload.sender_id, payload.receiver_id, payload.receiver_id, payload.sender_id),
        ).fetchone()

        if existing:
            if existing["status"] == "ACCEPTED":
                raise HTTPException(status_code=400, detail="You are already connected with this student.")
            if existing["status"] == "PENDING":
                if existing["sender_id"] == payload.sender_id:
                    raise HTTPException(status_code=400, detail="A connection request is already pending.")
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="This student has already sent you a connection request. Check your received requests to accept it.",
                    )

            # If existing was REJECTED, reactivate as PENDING
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                """
                UPDATE connection_requests
                SET sender_id = ?, receiver_id = ?, status = 'PENDING', message = ?, updated_at = ?
                WHERE id = ?
                """,
                (payload.sender_id, payload.receiver_id, payload.message or "", now_str, existing["id"]),
            )
            conn.commit()
            req_id = existing["id"]
        else:
            cur = conn.execute(
                """
                INSERT INTO connection_requests (sender_id, receiver_id, status, message)
                VALUES (?, ?, 'PENDING', ?)
                """,
                (payload.sender_id, payload.receiver_id, payload.message or ""),
            )
            conn.commit()
            req_id = cur.lastrowid

        row = conn.execute("SELECT * FROM connection_requests WHERE id = ?", (req_id,)).fetchone()
        sender_prof = fetch_profile_by_id(conn, payload.sender_id)
        receiver_prof = fetch_profile_by_id(conn, payload.receiver_id)

    return ConnectionRequestOut(
        id=row["id"],
        sender_id=row["sender_id"],
        receiver_id=row["receiver_id"],
        status=row["status"],
        message=row["message"] or "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        sender=sender_prof,
        receiver=receiver_prof,
    )


@app.get("/api/connect/requests/pending", response_model=list[ConnectionRequestOut], tags=["Campus Connect Requests"])
def get_pending_received_requests(profile_id: int = Query(..., description="Student profile ID")):
    """Get all incoming pending connection requests for a student."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM connection_requests
            WHERE receiver_id = ? AND status = 'PENDING'
            ORDER BY created_at DESC
            """,
            (profile_id,),
        ).fetchall()

        results = []
        for r in rows:
            sender_prof = fetch_profile_by_id(conn, r["sender_id"])
            receiver_prof = fetch_profile_by_id(conn, r["receiver_id"])
            results.append(
                ConnectionRequestOut(
                    id=r["id"],
                    sender_id=r["sender_id"],
                    receiver_id=r["receiver_id"],
                    status=r["status"],
                    message=r["message"] or "",
                    created_at=r["created_at"],
                    updated_at=r["updated_at"],
                    sender=sender_prof,
                    receiver=receiver_prof,
                )
            )

    return results


@app.get("/api/connect/requests/sent", response_model=list[ConnectionRequestOut], tags=["Campus Connect Requests"])
def get_pending_sent_requests(profile_id: int = Query(..., description="Student profile ID")):
    """Get all outgoing pending connection requests sent by a student."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM connection_requests
            WHERE sender_id = ? AND status = 'PENDING'
            ORDER BY created_at DESC
            """,
            (profile_id,),
        ).fetchall()

        results = []
        for r in rows:
            sender_prof = fetch_profile_by_id(conn, r["sender_id"])
            receiver_prof = fetch_profile_by_id(conn, r["receiver_id"])
            results.append(
                ConnectionRequestOut(
                    id=r["id"],
                    sender_id=r["sender_id"],
                    receiver_id=r["receiver_id"],
                    status=r["status"],
                    message=r["message"] or "",
                    created_at=r["created_at"],
                    updated_at=r["updated_at"],
                    sender=sender_prof,
                    receiver=receiver_prof,
                )
            )

    return results


@app.patch("/api/connect/requests/{request_id}", response_model=ConnectionRequestOut, tags=["Campus Connect Requests"])
def respond_to_connection_request(request_id: int, body: ConnectionRequestAction):
    """
    Accept or reject an incoming connection request.
    Enforces permission: only the recipient (receiver_id) can accept or reject.
    """
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM connection_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Connection request not found.")

        if row["status"] != "PENDING":
            raise HTTPException(status_code=400, detail=f"Request is already {row['status'].lower()}.")

        # Permission check: must be the receiver
        if row["receiver_id"] != body.profile_id:
            raise HTTPException(
                status_code=403,
                detail="Permission denied. Only the recipient can accept or reject this connection request.",
            )

        new_status = "ACCEPTED" if body.action == "ACCEPT" else "REJECTED"
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn.execute(
            "UPDATE connection_requests SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now_str, request_id),
        )
        conn.commit()

        updated = conn.execute("SELECT * FROM connection_requests WHERE id = ?", (request_id,)).fetchone()
        sender_prof = fetch_profile_by_id(conn, updated["sender_id"])
        receiver_prof = fetch_profile_by_id(conn, updated["receiver_id"])

    return ConnectionRequestOut(
        id=updated["id"],
        sender_id=updated["sender_id"],
        receiver_id=updated["receiver_id"],
        status=updated["status"],
        message=updated["message"] or "",
        created_at=updated["created_at"],
        updated_at=updated["updated_at"],
        sender=sender_prof,
        receiver=receiver_prof,
    )


@app.get("/api/connect/connections", response_model=list[ConnectionOut], tags=["Campus Connect Requests"])
def get_my_connections(profile_id: int = Query(..., description="Student profile ID")):
    """Get all accepted mutual connections for a student."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM connection_requests
            WHERE (sender_id = ? OR receiver_id = ?) AND status = 'ACCEPTED'
            ORDER BY updated_at DESC
            """,
            (profile_id, profile_id),
        ).fetchall()

        connections = []
        for r in rows:
            peer_id = r["receiver_id"] if r["sender_id"] == profile_id else r["sender_id"]
            peer_prof = fetch_profile_by_id(conn, peer_id)
            if peer_prof:
                connections.append(
                    ConnectionOut(
                        connection_id=r["id"],
                        peer_profile=peer_prof,
                        connected_since=r["updated_at"],
                    )
                )

    return connections


@app.get("/api/connect/requests/status-map", tags=["Campus Connect Requests"])
def get_connection_status_map(profile_id: int = Query(..., description="Student profile ID")):
    """
    Returns a map of { target_profile_id: 'PENDING_SENT' | 'PENDING_RECEIVED' | 'CONNECTED' | 'REJECTED' }
    for all students relative to the current profile.
    """
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, sender_id, receiver_id, status FROM connection_requests
            WHERE sender_id = ? OR receiver_id = ?
            """,
            (profile_id, profile_id),
        ).fetchall()

    status_map = {}
    for r in rows:
        if r["status"] == "ACCEPTED":
            target_id = r["receiver_id"] if r["sender_id"] == profile_id else r["sender_id"]
            status_map[target_id] = "CONNECTED"
        elif r["status"] == "PENDING":
            if r["sender_id"] == profile_id:
                status_map[r["receiver_id"]] = "PENDING_SENT"
            else:
                status_map[r["sender_id"]] = "PENDING_RECEIVED"
        elif r["status"] == "REJECTED":
            target_id = r["receiver_id"] if r["sender_id"] == profile_id else r["sender_id"]
            if target_id not in status_map:
                status_map[target_id] = "REJECTED"

    return status_map


# =============================================================================
# CAMPUS CONNECT: PEER-TO-PEER CHAT ROUTES
# =============================================================================

@app.get("/api/connect/messages/{connection_id}", response_model=list[PeerMessageOut], tags=["Peer Chat"])
def get_peer_messages(
    connection_id: int,
    profile_id: int = Query(..., description="Student profile ID of the participant requesting messages"),
):
    """Fetch chat history for an accepted peer-to-peer connection and mark incoming messages as read."""
    with get_connection() as conn:
        # Verify connection exists and is accepted
        req = conn.execute(
            "SELECT * FROM connection_requests WHERE id = ?",
            (connection_id,),
        ).fetchone()

        if not req:
            raise HTTPException(status_code=404, detail="Connection not found")
        if req["status"] != "ACCEPTED":
            raise HTTPException(status_code=400, detail="Cannot chat: connection is not accepted")
        if profile_id not in (req["sender_id"], req["receiver_id"]):
            raise HTTPException(status_code=403, detail="Not authorized to access messages for this connection")

        # Mark messages received by profile_id as read
        conn.execute(
            "UPDATE peer_messages SET is_read = 1 WHERE connection_id = ? AND receiver_id = ? AND is_read = 0",
            (connection_id, profile_id),
        )
        conn.commit()

        # Fetch messages
        rows = conn.execute(
            """
            SELECT id, connection_id, sender_id, receiver_id, content, is_read, created_at
            FROM peer_messages
            WHERE connection_id = ?
            ORDER BY id ASC
            """,
            (connection_id,),
        ).fetchall()

    return [
        PeerMessageOut(
            id=r["id"],
            connection_id=r["connection_id"],
            sender_id=r["sender_id"],
            receiver_id=r["receiver_id"],
            content=r["content"],
            is_read=bool(r["is_read"]),
            created_at=str(r["created_at"]),
        )
        for r in rows
    ]


@app.post("/api/connect/messages/{connection_id}", response_model=PeerMessageOut, status_code=201, tags=["Peer Chat"])
def send_peer_message(
    connection_id: int,
    payload: PeerMessageCreate,
):
    """Send a new message to a connected peer."""
    with get_connection() as conn:
        req = conn.execute(
            "SELECT * FROM connection_requests WHERE id = ?",
            (connection_id,),
        ).fetchone()

        if not req:
            raise HTTPException(status_code=404, detail="Connection not found")
        if req["status"] != "ACCEPTED":
            raise HTTPException(status_code=400, detail="Cannot send message: connection is not accepted")
        if payload.sender_id not in (req["sender_id"], req["receiver_id"]):
            raise HTTPException(status_code=403, detail="Sender is not a participant in this connection")

        receiver_id = req["receiver_id"] if payload.sender_id == req["sender_id"] else req["sender_id"]

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        cur = conn.execute(
            """
            INSERT INTO peer_messages (connection_id, sender_id, receiver_id, content, is_read, created_at)
            VALUES (?, ?, ?, ?, 0, ?)
            """,
            (connection_id, payload.sender_id, receiver_id, payload.content.strip(), now_str),
        )
        conn.commit()
        msg_id = cur.lastrowid

    return PeerMessageOut(
        id=msg_id,
        connection_id=connection_id,
        sender_id=payload.sender_id,
        receiver_id=receiver_id,
        content=payload.content.strip(),
        is_read=False,
        created_at=now_str,
    )


# =============================================================================
# DIRECT CHAT ROUTES (INSTANT CHAT BETWEEN ANY TWO STUDENTS/FRIENDS)
# =============================================================================

@app.get("/api/connect/direct-chat/{peer_id}", response_model=list[PeerMessageOut], tags=["Direct Peer Chat"])
def get_direct_messages(
    peer_id: int,
    my_id: int = Query(..., description="My student profile ID"),
):
    """Directly fetch message history between me and any student/friend without requiring prior handshake."""
    with get_connection() as conn:
        # Mark incoming messages from peer as read
        conn.execute(
            """
            UPDATE peer_messages
            SET is_read = 1
            WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
            """,
            (peer_id, my_id),
        )
        conn.commit()

        rows = conn.execute(
            """
            SELECT id, connection_id, sender_id, receiver_id, content, is_read, created_at
            FROM peer_messages
            WHERE (sender_id = ? AND receiver_id = ?)
               OR (sender_id = ? AND receiver_id = ?)
            ORDER BY id ASC
            """,
            (my_id, peer_id, peer_id, my_id),
        ).fetchall()

    return [
        PeerMessageOut(
            id=r["id"],
            connection_id=r["connection_id"],
            sender_id=r["sender_id"],
            receiver_id=r["receiver_id"],
            content=r["content"],
            is_read=bool(r["is_read"]),
            created_at=str(r["created_at"]),
        )
        for r in rows
    ]


@app.post("/api/connect/direct-chat/{peer_id}", response_model=PeerMessageOut, status_code=201, tags=["Direct Peer Chat"])
def send_direct_message(
    peer_id: int,
    payload: PeerMessageCreate,
):
    """Directly send a message to a student/friend, automatically creating/accepting the mutual connection."""
    with get_connection() as conn:
        # Verify sender and peer profiles exist
        sender_prof = fetch_profile_by_id(conn, payload.sender_id)
        peer_prof = fetch_profile_by_id(conn, peer_id)
        if not sender_prof or not peer_prof:
            raise HTTPException(status_code=404, detail="Student profile not found")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Check or auto-establish connection request so it shows in connections list
        existing_conn = conn.execute(
            """
            SELECT id, status FROM connection_requests
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            """,
            (payload.sender_id, peer_id, peer_id, payload.sender_id),
        ).fetchone()

        if existing_conn:
            conn_id = existing_conn["id"]
            if existing_conn["status"] != "ACCEPTED":
                conn.execute(
                    "UPDATE connection_requests SET status = 'ACCEPTED', updated_at = ? WHERE id = ?",
                    (now_str, conn_id),
                )
        else:
            cur = conn.execute(
                """
                INSERT INTO connection_requests (sender_id, receiver_id, status, message, created_at, updated_at)
                VALUES (?, ?, 'ACCEPTED', 'Direct Chat Connection', ?, ?)
                """,
                (payload.sender_id, peer_id, now_str, now_str),
            )
            conn_id = cur.lastrowid

        # Insert direct message
        cur_msg = conn.execute(
            """
            INSERT INTO peer_messages (connection_id, sender_id, receiver_id, content, is_read, created_at)
            VALUES (?, ?, ?, ?, 0, ?)
            """,
            (conn_id, payload.sender_id, peer_id, payload.content.strip(), now_str),
        )
        conn.commit()
        msg_id = cur_msg.lastrowid

    return PeerMessageOut(
        id=msg_id,
        connection_id=conn_id,
        sender_id=payload.sender_id,
        receiver_id=peer_id,
        content=payload.content.strip(),
        is_read=False,
        created_at=now_str,
    )


@app.get("/api/connect/conversations", response_model=list[DirectConversationOut], tags=["Direct Peer Chat"])
def get_conversations(
    profile_id: int = Query(..., description="My profile ID"),
):
    """Retrieve all conversations and recent peer chats for the user."""
    with get_connection() as conn:
        # Find all distinct peers
        rows = conn.execute(
            """
            SELECT DISTINCT
              CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS peer_id
            FROM peer_messages
            WHERE sender_id = ? OR receiver_id = ?
            """,
            (profile_id, profile_id, profile_id),
        ).fetchall()

        peer_ids = [r["peer_id"] for r in rows]

        conversations = []
        for pid in peer_ids:
            peer_prof = fetch_profile_by_id(conn, pid)
            if not peer_prof:
                continue

            last_msg_row = conn.execute(
                """
                SELECT content, created_at FROM peer_messages
                WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                ORDER BY id DESC LIMIT 1
                """,
                (profile_id, pid, pid, profile_id),
            ).fetchone()

            unread_count = conn.execute(
                """
                SELECT COUNT(*) FROM peer_messages
                WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
                """,
                (pid, profile_id),
            ).fetchone()[0]

            conversations.append(
                DirectConversationOut(
                    peer_profile=peer_prof,
                    last_message=last_msg_row["content"] if last_msg_row else None,
                    last_message_time=str(last_msg_row["created_at"]) if last_msg_row else None,
                    unread_count=unread_count,
                )
            )

        # Sort by last_message_time DESC
        conversations.sort(key=lambda c: c.last_message_time or "", reverse=True)

    return conversations


