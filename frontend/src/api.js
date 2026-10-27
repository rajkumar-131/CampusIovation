/**
 * api.js — Centralised API client for GreenCampus AI frontend.
 *
 * Connects React to the FastAPI backend running at http://localhost:8000.
 */

const rawBase = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8000' : 'https://greencampus-ai-tfjl.onrender.com')
).trim().replace(/\/+$/, '');

const API_BASE = rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`;

/**
 * Fetch with bounded timeout (15s) to gracefully handle cold starts
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s. The backend server may be waking up.`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

// =============================================================================
// GREENCAMPUS AI: ISSUE TICKETING
// =============================================================================

/**
 * Fetch health status of the backend
 */
export async function fetchHealth() {
  const response = await fetchWithTimeout(`${API_BASE}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch all tickets, with optional status filter ('Open' | 'In Progress' | 'Resolved')
 */
export async function fetchTickets(status = null) {
  const url = status && status !== 'All'
    ? `${API_BASE}/tickets?status=${encodeURIComponent(status)}`
    : `${API_BASE}/tickets`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load tickets (${response.status}): ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch dashboard summary aggregate counts
 */
export async function fetchDashboardSummary() {
  const response = await fetchWithTimeout(`${API_BASE}/dashboard/summary`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load dashboard summary (${response.status}): ${errorText}`);
  }
  return response.json();
}

/**
 * Create a new ticket (automatically classified by AI on the backend)
 */
export async function createTicket(ticketData) {
  const response = await fetchWithTimeout(`${API_BASE}/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ticketData),
  }, 25000); // 25s timeout for AI classification

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        if (Array.isArray(errorJson.detail)) {
          errorMessage = errorJson.detail.map(e => e.msg).join(', ');
        } else {
          errorMessage = errorJson.detail;
        }
      }
    } catch {
      // Use fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update the status of a specific ticket ('Open' | 'In Progress' | 'Resolved')
 */
export async function updateTicketStatus(ticketId, status) {
  const response = await fetchWithTimeout(`${API_BASE}/tickets/${ticketId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    let errorMessage = `Failed to update status (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) errorMessage = errorJson.detail;
    } catch {
      // Use fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}


// =============================================================================
// CAMPUS CONNECT: PROFILES & AVAILABILITY
// =============================================================================

/**
 * Fetch all students currently broadcasting active, non-expired availability.
 */
export async function fetchActiveStudents(activity = null, interest = null, locationArea = null) {
  const params = new URLSearchParams();
  if (activity && activity !== 'All') params.append('activity', activity);
  if (interest && interest !== 'All') params.append('interest', interest);
  if (locationArea && locationArea !== 'All Areas') params.append('location_area', locationArea);

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const response = await fetchWithTimeout(`${API_BASE}/connect/available${queryStr}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load active students (${response.status}): ${errorText}`);
  }
  return response.json();
}

/**
 * List all registered student profiles
 */
export async function fetchProfiles() {
  const response = await fetchWithTimeout(`${API_BASE}/connect/profiles`);
  if (!response.ok) {
    throw new Error(`Failed to load student profiles (${response.status})`);
  }
  return response.json();
}

/**
 * Get profile details and active broadcast for a specific profile ID
 */
export async function fetchStudentProfile(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/profiles/${profileId}`);
  if (!response.ok) {
    throw new Error(`Failed to load profile for ID ${profileId}`);
  }
  return response.json();
}

/**
 * Create a new student profile
 */
export async function createStudentProfile(profileData) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profileData),
  });

  if (!response.ok) {
    let errorMessage = `Failed to create profile (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        if (Array.isArray(errorJson.detail)) {
          errorMessage = errorJson.detail.map(e => e.msg).join(', ');
        } else {
          errorMessage = errorJson.detail;
        }
      }
    } catch {
      // Fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Broadcast student availability for 15, 30, or 60 mins
 */
export async function broadcastAvailability(availabilityData) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/availability`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(availabilityData),
  });

  if (!response.ok) {
    let errorMessage = `Failed to broadcast availability (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        if (Array.isArray(errorJson.detail)) {
          errorMessage = errorJson.detail.map(e => e.msg).join(', ');
        } else {
          errorMessage = errorJson.detail;
        }
      }
    } catch {
      // Fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Cancel/stop broadcasting availability for a profile
 */
export async function cancelAvailability(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/availability/${profileId}/cancel`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel availability (${response.status})`);
  }

  return response.json();
}


// =============================================================================
// CAMPUS CONNECT STEP 2: CONNECTION REQUESTS & MUTUAL CONNECTIONS
// =============================================================================

/**
 * Send a connection request to another student
 */
export async function sendConnectionRequest(senderId, receiverId, message = '') {
  const response = await fetchWithTimeout(`${API_BASE}/connect/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_id: senderId,
      receiver_id: receiverId,
      message,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Failed to send connection request (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) errorMessage = errorJson.detail;
    } catch {
      // Fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetch incoming pending requests received by a student
 */
export async function fetchPendingReceivedRequests(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/requests/pending?profile_id=${profileId}`);
  if (!response.ok) {
    throw new Error(`Failed to load received requests (${response.status})`);
  }
  return response.json();
}

/**
 * Fetch outgoing pending requests sent by a student
 */
export async function fetchPendingSentRequests(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/requests/sent?profile_id=${profileId}`);
  if (!response.ok) {
    throw new Error(`Failed to load sent requests (${response.status})`);
  }
  return response.json();
}

/**
 * Respond to an incoming connection request (ACCEPT or REJECT)
 */
export async function respondToConnectionRequest(requestId, action, profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/requests/${requestId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      profile_id: profileId,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Failed to respond to request (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) errorMessage = errorJson.detail;
    } catch {
      // Fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Fetch mutual accepted connections for a student
 */
export async function fetchMyConnections(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/connections?profile_id=${profileId}`);
  if (!response.ok) {
    throw new Error(`Failed to load connections (${response.status})`);
  }
  return response.json();
}

/**
 * Fetch status map for all students relative to current profile
 */
export async function fetchConnectionStatusMap(profileId) {
  const response = await fetchWithTimeout(`${API_BASE}/connect/requests/status-map?profile_id=${profileId}`);
  if (!response.ok) {
    throw new Error(`Failed to load connection status map (${response.status})`);
  }
  return response.json();
}

// =============================================================================
// CAMPUS AI CONVERSATIONAL ASSISTANT (ECHO)
// =============================================================================

/**
 * Send message to Campus AI Assistant with rate-limit failover
 */
export async function sendChatMessage(message, history = []) {
  const response = await fetchWithTimeout(
    `${API_BASE}/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, history }),
    },
    25000
  );

  if (!response.ok) {
    let errorMessage = `AI Assistant is temporarily unavailable (${response.status})`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        errorMessage = Array.isArray(errorJson.detail)
          ? errorJson.detail.map((e) => e.msg).join(', ')
          : errorJson.detail;
      }
    } catch {
      // Fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
