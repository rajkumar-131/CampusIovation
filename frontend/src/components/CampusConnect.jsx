import { useState, useEffect, useCallback } from 'react'
import PeerChatModal from './PeerChatModal'
import {
  fetchActiveStudents,
  fetchProfiles,
  fetchStudentProfile,
  createStudentProfile,
  broadcastAvailability,
  cancelAvailability,
  sendConnectionRequest,
  fetchPendingReceivedRequests,
  fetchPendingSentRequests,
  respondToConnectionRequest,
  fetchMyConnections,
  fetchConnectionStatusMap,
  fetchConversations,
} from '../api'

// Predefined activities with icons & labels
const ACTIVITIES = [
  { key: 'STUDY', label: 'Study Session', emoji: '📚', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'COFFEE', label: 'Grab Coffee', emoji: '☕', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'LUNCH', label: 'Have Lunch', emoji: '🍔', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'WALK', label: 'Campus Walk', emoji: '🚶', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'CASUAL_CHAT', label: 'Casual Chat', emoji: '💬', color: 'bg-purple-100 text-purple-700 border-purple-200' },
]

// Predefined durations
const DURATIONS = [
  { minutes: 15, label: '15 mins' },
  { minutes: 30, label: '30 mins' },
  { minutes: 60, label: '60 mins' },
]

// Predefined general campus areas (strictly non-GPS)
const CAMPUS_AREAS = [
  'Central Library',
  'Main Cafeteria',
  'Student Activity Center (SAC)',
  'Science & Engineering Quad',
  'Hostel Common Room',
  'Sports Complex & Ground',
  'Green Lawn / Campus Park',
  'Anywhere on Campus',
]

// Common interest tags
const POPULAR_INTERESTS = [
  'Coding',
  'AI & ML',
  'Robotics',
  'Web Dev',
  'Environment & Green Tech',
  'Design & UI/UX',
  'Reading & Literature',
  'Music',
  'Photography',
  'Football',
  'Badminton',
  'Gaming',
  'Debating & MUN',
  'Startups',
]

// Study year choices
const STUDY_YEARS = [
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
  'Postgraduate',
]

export default function CampusConnect() {
  // ── Navigation Tabs ────────────────────────────────────────────────────────
  // 'directory' | 'requests' | 'connections'
  const [activeTab, setActiveTab] = useState('directory')

  // ── State: Active directory ────────────────────────────────────────────────
  const [activeStudents, setActiveStudents] = useState([])
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [directoryError, setDirectoryError] = useState(null)
  const [selectedActivity, setSelectedActivity] = useState('All')
  const [selectedInterest, setSelectedInterest] = useState('All')

  // ── State: Student Profile & My Status ─────────────────────────────────────
  const [profiles, setProfiles] = useState([])
  const [currentProfileId, setCurrentProfileId] = useState(() => {
    return localStorage.getItem('greencampus_connect_profile_id') || ''
  })
  const [myProfileData, setMyProfileData] = useState(null)
  const [myActiveAvailability, setMyActiveAvailability] = useState(null)
  const [isCreatingProfile, setIsCreatingProfile] = useState(false)
  const [profileFormError, setProfileFormError] = useState(null)
  const [profileFormLoading, setProfileFormLoading] = useState(false)

  // Profile form state
  const [newProfile, setNewProfile] = useState({
    name: '',
    department: 'Computer Science & Engineering',
    study_year: '2nd Year',
    bio: '',
    interests: [],
  })

  // Broadcast form state
  const [broadcastForm, setBroadcastForm] = useState({
    activity: 'STUDY',
    duration_minutes: 30,
    location_area: 'Central Library',
    note: '',
  })
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [broadcastError, setBroadcastError] = useState(null)
  const [isCancelling, setIsCancelling] = useState(false)

  // ── State: Step 2 Connections & Requests ──────────────────────────────────
  const [statusMap, setStatusMap] = useState({})
  const [pendingReceived, setPendingReceived] = useState([])
  const [pendingSent, setPendingSent] = useState([])
  const [connections, setConnections] = useState([])
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [requestsError, setRequestsError] = useState(null)

  // Connection request modal / inline message
  const [targetStudentForRequest, setTargetStudentForRequest] = useState(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [requestFeedback, setRequestFeedback] = useState(null) // { type: 'success' | 'error', text: '' }

  // Peer-to-peer active chat
  const [activeChatPeer, setActiveChatPeer] = useState(null)
  const [conversations, setConversations] = useState([])
  const [loadingConversations, setLoadingConversations] = useState(false)

  // ── Load active students directory ─────────────────────────────────────────
  const loadActiveStudents = useCallback(async () => {
    setLoadingDirectory(true)
    setDirectoryError(null)
    try {
      const data = await fetchActiveStudents(selectedActivity, selectedInterest)
      setActiveStudents(data)
    } catch (err) {
      console.error('Failed to load active students:', err)
     setDirectoryError(
  'Unable to load available students. Please check the deployed backend and try again.'
)
    } finally {
      setLoadingDirectory(false)
    }
  }, [selectedActivity, selectedInterest])

  // ── Load Connection Requests & Status Map ──────────────────────────────────
  const loadConnectionData = useCallback(async (profId) => {
    if (!profId) return
    setLoadingRequests(true)
    setRequestsError(null)
    try {
      const [mapData, receivedData, sentData, connectionsData] = await Promise.all([
        fetchConnectionStatusMap(profId).catch(() => ({})),
        fetchPendingReceivedRequests(profId).catch(() => []),
        fetchPendingSentRequests(profId).catch(() => []),
        fetchMyConnections(profId).catch(() => []),
      ])
      setStatusMap(mapData || {})
      setPendingReceived(receivedData || [])
      setPendingSent(sentData || [])
      setConnections(connectionsData || [])
    } catch (err) {
      console.error('Failed to load connections data:', err)
      setRequestsError('Unable to sync connection requests.')
    } finally {
      setLoadingRequests(false)
    }
  }, [])

  // ── Load Direct Conversations ──────────────────────────────────────────────
  const loadConversationsData = useCallback(async (profId) => {
    if (!profId) return
    setLoadingConversations(true)
    try {
      const data = await fetchConversations(profId)
      setConversations(data || [])
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      setLoadingConversations(false)
    }
  }, [])

  // ── Load profiles and current user profile ─────────────────────────────────
  const loadProfilesAndMyStatus = useCallback(async () => {
    try {
      const allProfiles = await fetchProfiles()
      setProfiles(allProfiles)

      let effectiveId = currentProfileId
      if (!effectiveId && allProfiles.length > 0) {
        effectiveId = String(allProfiles[0].id)
        setCurrentProfileId(effectiveId)
        localStorage.setItem('greencampus_connect_profile_id', effectiveId)
      }

      if (effectiveId) {
        try {
          const detail = await fetchStudentProfile(effectiveId)
          setMyProfileData(detail.profile)
          setMyActiveAvailability(detail.active_availability)
          loadConnectionData(effectiveId)
          loadConversationsData(effectiveId)
        } catch {
          setMyProfileData(null)
          setMyActiveAvailability(null)
        }
      }
    } catch (err) {
      console.error('Failed to load profiles:', err)
    }
  }, [currentProfileId, loadConnectionData])

  useEffect(() => {
    loadActiveStudents()
  }, [loadActiveStudents])

  useEffect(() => {
    loadProfilesAndMyStatus()
  }, [loadProfilesAndMyStatus])

  // ── Switch Active Profile ──────────────────────────────────────────────────
  const handleProfileSelectChange = async (e) => {
    const val = e.target.value
    if (val === '__new__') {
      setIsCreatingProfile(true)
      return
    }
    setCurrentProfileId(val)
    localStorage.setItem('greencampus_connect_profile_id', val)
    if (val) {
      try {
        const detail = await fetchStudentProfile(val)
        setMyProfileData(detail.profile)
        setMyActiveAvailability(detail.active_availability)
        loadConnectionData(val)
      } catch {
        setMyProfileData(null)
        setMyActiveAvailability(null)
      }
    } else {
      setMyProfileData(null)
      setMyActiveAvailability(null)
    }
  }

  // ── Create Profile Submit ──────────────────────────────────────────────────
  const handleCreateProfileSubmit = async (e) => {
    e.preventDefault()
    setProfileFormError(null)

    if (!newProfile.name.trim()) {
      setProfileFormError('Display name is required')
      return
    }
    if (!newProfile.department.trim()) {
      setProfileFormError('Department is required')
      return
    }

    setProfileFormLoading(true)
    try {
      const created = await createStudentProfile({
        name: newProfile.name.trim(),
        department: newProfile.department.trim(),
        study_year: newProfile.study_year,
        bio: newProfile.bio.trim(),
        interests: newProfile.interests,
      })

      setCurrentProfileId(String(created.id))
      localStorage.setItem('greencampus_connect_profile_id', String(created.id))
      setMyProfileData(created)
      setMyActiveAvailability(null)
      setIsCreatingProfile(false)
      setNewProfile({
        name: '',
        department: 'Computer Science & Engineering',
        study_year: '2nd Year',
        bio: '',
        interests: [],
      })
      await loadProfilesAndMyStatus()
    } catch (err) {
      console.error('Failed to create profile:', err)
      setProfileFormError(err.message || 'Error creating profile')
    } finally {
      setProfileFormLoading(false)
    }
  }

  const toggleInterest = (interest) => {
    setNewProfile(prev => {
      const exists = prev.interests.includes(interest)
      return {
        ...prev,
        interests: exists
          ? prev.interests.filter(i => i !== interest)
          : [...prev.interests, interest],
      }
    })
  }

  // ── Broadcast Availability Submit ──────────────────────────────────────────
  const handleBroadcastSubmit = async (e) => {
    e.preventDefault()
    if (!currentProfileId) {
      setBroadcastError('Please select or create a profile first.')
      return
    }

    setBroadcastError(null)
    setIsBroadcasting(true)

    try {
      const result = await broadcastAvailability({
        profile_id: parseInt(currentProfileId, 10),
        activity: broadcastForm.activity,
        duration_minutes: parseInt(broadcastForm.duration_minutes, 10),
        location_area: broadcastForm.location_area,
        note: broadcastForm.note.trim(),
      })

      setMyActiveAvailability(result)
      loadActiveStudents()
    } catch (err) {
      console.error('Failed to broadcast availability:', err)
      setBroadcastError(err.message || 'Error broadcasting availability')
    } finally {
      setIsBroadcasting(false)
    }
  }

  // ── Cancel Availability ────────────────────────────────────────────────────
  const handleCancelAvailability = async () => {
    if (!currentProfileId) return
    setIsCancelling(true)
    try {
      await cancelAvailability(parseInt(currentProfileId, 10))
      setMyActiveAvailability(null)
      loadActiveStudents()
    } catch (err) {
      console.error('Failed to cancel availability:', err)
    } finally {
      setIsCancelling(false)
    }
  }

  // ── Step 2: Send Connection Request ────────────────────────────────────────
  const handleSendRequestSubmit = async (e) => {
    e.preventDefault()
    if (!targetStudentForRequest || !currentProfileId) return

    setSendingRequest(true)
    setRequestFeedback(null)

    try {
      await sendConnectionRequest(
        parseInt(currentProfileId, 10),
        targetStudentForRequest.profile_id,
        requestMessage.trim()
      )

      setRequestFeedback({
        type: 'success',
        text: `Connection request sent to ${targetStudentForRequest.name}!`,
      })

      // Update status map optimistically
      setStatusMap(prev => ({
        ...prev,
        [targetStudentForRequest.profile_id]: 'PENDING_SENT',
      }))

      // Reset modal state
      setTimeout(() => {
        setTargetStudentForRequest(null)
        setRequestMessage('')
        setRequestFeedback(null)
      }, 1500)

      // Reload connection data
      loadConnectionData(currentProfileId)
    } catch (err) {
      console.error('Failed to send request:', err)
      setRequestFeedback({
        type: 'error',
        text: err.message || 'Unable to send request.',
      })
    } finally {
      setSendingRequest(false)
    }
  }

  // ── Step 2: Respond to Incoming Connection Request (Accept/Reject) ──────────
  const handleRespondRequest = async (requestId, action) => {
    if (!currentProfileId) return
    try {
      await respondToConnectionRequest(requestId, action, parseInt(currentProfileId, 10))
      // Refresh connection data and status map
      loadConnectionData(currentProfileId)
    } catch (err) {
      console.error(`Failed to ${action} request:`, err)
      alert(`Could not ${action.toLowerCase()} request: ${err.message}`)
    }
  }

  // Helper to find activity meta
  const getActivityMeta = (key) => {
    return ACTIVITIES.find(a => a.key === key) || {
      key,
      label: key,
      emoji: '⚡',
      color: 'bg-gray-100 text-gray-700 border-gray-200',
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-3xl">🤝</span>
            <h2 className="text-2xl font-bold text-gray-800">Campus Connect</h2>
            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-green-200">
              Live & Opt-in
            </span>
          </div>
          <p className="text-gray-500 text-sm max-w-2xl leading-relaxed">
            Spontaneously find peers for study sessions, coffee breaks, quick lunch, or campus walks.
            Students appear here <strong>only when they opt in</strong> for a set duration. Non-GPS, privacy-first.
          </p>
        </div>

        {/* Profile Switcher dropdown */}
        <div className="flex items-center gap-2 self-start sm:self-auto bg-white border border-gray-200 rounded-xl p-2 shadow-sm text-sm">
          <span className="text-gray-400 text-xs font-medium">Logged in as:</span>
          <select
            value={isCreatingProfile ? '__new__' : currentProfileId}
            onChange={handleProfileSelectChange}
            className="bg-transparent font-semibold text-gray-800 focus:outline-none cursor-pointer"
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.department.split('&')[0].trim()})
              </option>
            ))}
            <option value="__new__">+ Create New Profile…</option>
          </select>
        </div>
      </div>

      {/* ── SECTION 1: MY STATUS & BROADCAST CARD ───────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Create Profile In-line Form */}
        {isCreatingProfile ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">👤 Create Your Student Profile</h3>
              {profiles.length > 0 && (
                <button
                  onClick={() => setIsCreatingProfile(false)}
                  className="text-gray-400 hover:text-gray-600 text-sm"
                >
                  Cancel
                </button>
              )}
            </div>

            {profileFormError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
                ⚠️ {profileFormError}
              </div>
            )}

            <form onSubmit={handleCreateProfileSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Display Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Sarah Jenkins"
                    value={newProfile.name}
                    onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Department / Major <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Computer Science & Engineering"
                    value={newProfile.department}
                    onChange={(e) => setNewProfile({ ...newProfile, department: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Study Year</label>
                  <select
                    value={newProfile.study_year}
                    onChange={(e) => setNewProfile({ ...newProfile, study_year: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {STUDY_YEARS.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Short Bio</label>
                  <input
                    type="text"
                    maxLength={150}
                    placeholder="e.g. Studying for algorithms midterms, loves tea"
                    value={newProfile.bio}
                    onChange={(e) => setNewProfile({ ...newProfile, bio: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Interests / Hobbies</label>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_INTERESTS.map(interest => {
                    const isSelected = newProfile.interests.includes(interest)
                    return (
                      <button
                        type="button"
                        key={interest}
                        onClick={() => toggleInterest(interest)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-green-600 text-white border-green-600 font-medium'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}{interest}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                {profiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingProfile(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={profileFormLoading}
                  className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {profileFormLoading ? 'Creating Profile…' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        ) : myActiveAvailability ? (
          /* User is actively broadcasting */
          <div className="p-6 bg-gradient-to-r from-green-50/60 to-emerald-50/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <span className="text-xs font-bold text-green-800 uppercase tracking-wider">
                    You Are Currently Available
                  </span>
                  <span className="text-xs bg-green-200 text-green-900 font-mono font-semibold px-2 py-0.5 rounded-full">
                    ⏱️ {myActiveAvailability.minutes_remaining} min{myActiveAvailability.minutes_remaining === 1 ? '' : 's'} remaining
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {(() => {
                    const meta = getActivityMeta(myActiveAvailability.activity)
                    return (
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${meta.color}`}>
                        <span>{meta.emoji}</span>
                        <span>{meta.label}</span>
                      </span>
                    )
                  })()}
                  <span className="text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2.5 py-1">
                    📍 {myActiveAvailability.location_area}
                  </span>
                  {myActiveAvailability.note && (
                    <span className="text-xs text-gray-500 italic">
                      &quot;{myActiveAvailability.note}&quot;
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={handleCancelAvailability}
                disabled={isCancelling}
                className="self-start sm:self-auto px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 hover:border-red-400 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>⏹️</span>
                <span>{isCancelling ? 'Stopping…' : 'Stop Being Available'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* User has a profile but is not currently available */
          <div className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  👋 Ready to meet or study, {myProfileData ? myProfileData.name : 'Student'}?
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Set an activity and duration. Your status automatically expires when time is up.
                </p>
              </div>
              <button
                onClick={() => setIsCreatingProfile(true)}
                className="text-xs text-green-700 hover:text-green-800 font-medium self-start md:self-auto"
              >
                ✏️ Edit My Profile
              </button>
            </div>

            {broadcastError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
                ⚠️ {broadcastError}
              </div>
            )}

            <form onSubmit={handleBroadcastSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">What are you up for?</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {ACTIVITIES.map(act => (
                    <button
                      type="button"
                      key={act.key}
                      onClick={() => setBroadcastForm({ ...broadcastForm, activity: act.key })}
                      className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                        broadcastForm.activity === act.key
                          ? 'border-green-600 bg-green-50 text-green-800 ring-2 ring-green-600/20 font-bold'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-xl mb-1">{act.emoji}</div>
                      <div>{act.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">How long are you free?</label>
                  <div className="flex gap-2">
                    {DURATIONS.map(d => (
                      <button
                        type="button"
                        key={d.minutes}
                        onClick={() => setBroadcastForm({ ...broadcastForm, duration_minutes: d.minutes })}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          broadcastForm.duration_minutes === d.minutes
                            ? 'bg-green-600 text-white border-green-600 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">General Location (Non-GPS)</label>
                  <select
                    value={broadcastForm.location_area}
                    onChange={(e) => setBroadcastForm({ ...broadcastForm, location_area: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  >
                    {CAMPUS_AREAS.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Optional Note</label>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="e.g. Table 4 near windows"
                    value={broadcastForm.note}
                    onChange={(e) => setBroadcastForm({ ...broadcastForm, note: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isBroadcasting}
                  className="w-full sm:w-auto px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <span>📡</span>
                  <span>{isBroadcasting ? 'Broadcasting…' : 'Go Active on Campus'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* ── SECTION 2: NAVIGATION TABS (Directory / Requests / Connections) ── */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setActiveTab('directory')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === 'directory'
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <span>📡 Live Campus Directory</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'directory' ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {activeStudents.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === 'requests'
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <span>📬 Requests</span>
          {pendingReceived.length > 0 ? (
            <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
              {pendingReceived.length} new
            </span>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'requests' ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
              0
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('connections')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === 'connections'
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <span>👥 My Connections</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'connections' ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {connections.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('direct_chats')
            if (currentProfileId) loadConversationsData(currentProfileId)
          }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'direct_chats'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <span>💬 Direct Messages</span>
          {conversations.length > 0 ? (
            <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'direct_chats' ? 'bg-white text-emerald-800' : 'bg-emerald-100 text-emerald-800'} font-bold`}>
              {conversations.length}
            </span>
          ) : (
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full font-bold">
              Direct
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: LIVE DIRECTORY ────────────────────────────────────────────── */}
      {activeTab === 'directory' && (
        <div>
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedActivity('All')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedActivity === 'All'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
                }`}
              >
                All Activities
              </button>
              {ACTIVITIES.map(a => (
                <button
                  key={a.key}
                  onClick={() => setSelectedActivity(a.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                    selectedActivity === a.key
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
                  }`}
                >
                  <span>{a.emoji}</span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span>Interest:</span>
              <select
                value={selectedInterest}
                onChange={(e) => setSelectedInterest(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="All">All Interests</option>
                {POPULAR_INTERESTS.map(i => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          {directoryError && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center my-6">
              <p className="text-red-700 text-sm mb-3">⚠️ {directoryError}</p>
              <button
                onClick={loadActiveStudents}
                className="px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700"
              >
                🔄 Retry Connection
              </button>
            </div>
          )}

          {loadingDirectory ? (
            <div className="text-center py-20 text-gray-400">
              <div className="inline-block animate-spin text-3xl mb-3">🤝</div>
              <p className="text-sm font-medium text-gray-600">Finding available peers on campus…</p>
            </div>
          ) : activeStudents.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
              <p className="text-4xl mb-3">☕</p>
              <h4 className="text-lg font-bold text-gray-700 mb-1">No students available with this filter right now</h4>
              <p className="text-xs text-gray-400 max-w-md mx-auto mb-5 leading-relaxed">
                Availabilities expire automatically to keep things live and relevant.
              </p>
              <button
                onClick={() => { setSelectedActivity('All'); setSelectedInterest('All'); }}
                className="px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-semibold hover:bg-green-100"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeStudents.map(student => {
                const meta = getActivityMeta(student.activity)
                const isMe = String(student.profile_id) === String(currentProfileId)
                const connStatus = statusMap[student.profile_id] || 'NONE'

                return (
                  <div
                    key={student.availability_id}
                    className={`bg-white rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
                      isMe ? 'border-green-300 ring-1 ring-green-400/30 bg-green-50/20' : 'border-gray-200'
                    }`}
                  >
                    <div>
                      {/* Header: Name + Activity Badge */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-bold text-gray-800 text-sm">{student.name}</h4>
                            {isMe && (
                              <span className="text-[10px] bg-green-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                                You
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {student.study_year} • {student.department}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.color}`}>
                          <span>{meta.emoji}</span>
                          <span>{meta.label}</span>
                        </span>
                      </div>

                      {/* Bio */}
                      {student.bio && (
                        <p className="text-xs text-gray-600 mt-2 mb-3 line-clamp-2 italic">
                          &quot;{student.bio}&quot;
                        </p>
                      )}

                      {/* Note if any */}
                      {student.note && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 mb-3 flex items-start gap-1.5">
                          <span>💬</span>
                          <span className="leading-snug">{student.note}</span>
                        </div>
                      )}

                      {/* Interests tags */}
                      {student.interests && student.interests.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {student.interests.map((interest, idx) => (
                            <span
                              key={idx}
                              className="bg-gray-50 border border-gray-200 text-gray-600 text-[11px] px-2 py-0.5 rounded-full"
                            >
                              #{interest}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      {/* Location & Remaining Time row */}
                      <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 mb-3">
                        <span className="flex items-center gap-1 font-medium text-gray-700">
                          <span>📍</span>
                          <span>{student.location_area}</span>
                        </span>

                        <span className="inline-flex items-center gap-1 text-green-700 font-mono font-semibold bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                          <span>⏱️</span>
                          <span>{student.minutes_remaining}m left</span>
                        </span>
                      </div>

                      {/* Step 2: Connection Action Bar */}
                      {!isMe && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              setActiveChatPeer({
                                id: student.profile_id,
                                name: student.name,
                                department: student.department,
                                study_year: student.study_year,
                                bio: student.bio,
                                interests: student.interests,
                              })
                            }
                            className="flex-1 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-600/20 active:scale-98"
                            title={`Chat directly with ${student.name}`}
                          >
                            <span>💬</span>
                            <span>Chat Directly</span>
                          </button>

                          {connStatus === 'CONNECTED' ? (
                            <span className="px-2.5 py-2 bg-green-50 border border-green-200 text-green-700 rounded-xl text-xs font-bold" title="Connected">
                              ✅
                            </span>
                          ) : connStatus === 'PENDING_SENT' ? (
                            <span className="px-2.5 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold" title="Request Sent">
                              ⏳
                            </span>
                          ) : connStatus === 'PENDING_RECEIVED' ? (
                            <button
                              onClick={() => setActiveTab('requests')}
                              className="px-2.5 py-2 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold"
                              title="Accept pending request"
                            >
                              📥
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setTargetStudentForRequest(student)
                                setRequestMessage(`Hi ${student.name}! Want to ${meta.label.toLowerCase()} together?`)
                                setRequestFeedback(null)
                              }}
                              className="px-2.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-colors"
                              title="Send connection request"
                            >
                              🤝
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CONNECTION REQUESTS ────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          {/* Incoming Requests */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <span>📬 Incoming Requests</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                  {pendingReceived.length}
                </span>
              </h3>
            </div>

            {pendingReceived.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 shadow-sm">
                <p className="text-3xl mb-2">📭</p>
                <p className="text-sm font-medium">No pending incoming connection requests</p>
                <p className="text-xs text-gray-400 mt-1">
                  When other students ask to connect with you, they will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingReceived.map(req => (
                  <div key={req.id} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-gray-800 text-sm">{req.sender?.name}</h4>
                        <p className="text-xs text-gray-500">
                          {req.sender?.study_year} • {req.sender?.department}
                        </p>
                      </div>
                      <span className="text-[11px] text-gray-400">
                        {req.created_at}
                      </span>
                    </div>

                    {req.message && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-700 italic">
                        &quot;{req.message}&quot;
                      </div>
                    )}

                    {req.sender?.interests && req.sender.interests.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {req.sender.interests.map((i, idx) => (
                          <span key={idx} className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                            #{i}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-100 flex gap-2">
                      <button
                        onClick={() => handleRespondRequest(req.id, 'ACCEPT')}
                        className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors shadow-sm"
                      >
                        ✓ Accept Connection
                      </button>
                      <button
                        onClick={() => handleRespondRequest(req.id, 'REJECT')}
                        className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outgoing Requests */}
          <div>
            <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              <span>📤 Sent Requests</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold">
                {pendingSent.length}
              </span>
            </h3>

            {pendingSent.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-400 shadow-sm text-xs">
                No outgoing requests currently waiting for response.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingSent.map(req => (
                  <div key={req.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-800 text-xs">To: {req.receiver?.name}</h4>
                      <p className="text-[11px] text-gray-500">
                        {req.receiver?.study_year} • {req.receiver?.department}
                      </p>
                      {req.message && (
                        <p className="text-xs text-gray-600 italic mt-1 line-clamp-1">&quot;{req.message}&quot;</p>
                      )}
                    </div>
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium">
                      ⏳ Pending
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: MY CONNECTIONS ────────────────────────────────────────────── */}
      {activeTab === 'connections' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <span>👥 Mutual Connections</span>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                {connections.length}
              </span>
            </h3>
          </div>

          {connections.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-500 shadow-sm">
              <p className="text-4xl mb-3">🤝</p>
              <h4 className="text-base font-bold text-gray-700 mb-1">No connections yet</h4>
              <p className="text-xs text-gray-400 max-w-sm mx-auto mb-4 leading-relaxed">
                Send a connection request to active students in the directory to establish mutual connections.
              </p>
              <button
                onClick={() => setActiveTab('directory')}
                className="px-4 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
              >
                Find Peers in Directory →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map(conn => {
                const peer = conn.peer_profile
                return (
                  <div key={conn.connection_id} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-gray-800 text-sm">{peer.name}</h4>
                        <p className="text-xs text-gray-500">
                          {peer.study_year} • {peer.department}
                        </p>
                      </div>
                      <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-semibold">
                        Connected
                      </span>
                    </div>

                    {peer.bio && (
                      <p className="text-xs text-gray-600 italic line-clamp-2">
                        &quot;{peer.bio}&quot;
                      </p>
                    )}

                    {peer.interests && peer.interests.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {peer.interests.map((i, idx) => (
                          <span key={idx} className="text-[10px] bg-gray-50 border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                            #{i}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Connected since:</span>
                      <span>{conn.connected_since.split(' ')[0]}</span>
                    </div>

                    <button
                      onClick={() => setActiveChatPeer(peer)}
                      className="w-full mt-2 py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-600/20 active:scale-98"
                    >
                      <span>💬</span>
                      <span>Chat with {peer.name.split(' ')[0]}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: DIRECT MESSAGES (CHAT WITH ANY FRIEND DIRECTLY) ─────────── */}
      {activeTab === 'direct_chats' && (
        <div className="space-y-6 animate-fade-in">
          {/* Header Card with Friend Selector */}
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-white rounded-2xl border border-emerald-200/80 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">💬</span>
                <h3 className="text-base font-bold text-gray-800">Direct Peer Messages</h3>
                <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold">
                  Instant P2P
                </span>
              </div>
              <p className="text-xs text-gray-600 max-w-xl">
                Chat directly with your friends or any student on campus in real time. No connection approval required.
              </p>
            </div>

            {/* Quick Friend Selector to start new chat */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 flex-shrink-0">Start Chat with:</span>
              <select
                onChange={(e) => {
                  const targetId = parseInt(e.target.value, 10)
                  if (!targetId) return
                  const found = profiles.find(p => p.id === targetId)
                  if (found) setActiveChatPeer(found)
                  e.target.value = ''
                }}
                defaultValue=""
                className="bg-white border border-gray-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-xs outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="" disabled>Select a student / friend…</option>
                {profiles
                  .filter(p => String(p.id) !== String(currentProfileId))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.department.split('&')[0].trim()})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Conversation Cards List */}
          {loadingConversations ? (
            <div className="text-center py-16 text-gray-400">
              <div className="inline-block animate-spin text-3xl mb-2">🌿</div>
              <p className="text-xs font-semibold">Loading your conversations...</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-3xl border border-gray-200 p-8 shadow-sm space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 text-3xl flex items-center justify-center mx-auto">
                💬
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-800">No messages yet</h4>
                <p className="text-xs text-gray-400 max-w-md mx-auto mt-1 leading-relaxed">
                  Start a conversation with a peer from the directory or pick a friend from the dropdown above to chat directly!
                </p>
              </div>

              {/* Student quick-chips */}
              <div className="pt-2">
                <p className="text-xs font-bold text-gray-500 mb-2">Available students to message right now:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {profiles
                    .filter(p => String(p.id) !== String(currentProfileId))
                    .slice(0, 4)
                    .map(p => (
                      <button
                        key={p.id}
                        onClick={() => setActiveChatPeer(p)}
                        className="px-3.5 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-xl transition shadow-2xs flex items-center gap-1.5"
                      >
                        <span>💬</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {conversations.map(conv => {
                const peer = conv.peer_profile
                return (
                  <div
                    key={peer.id}
                    className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 text-white font-bold flex items-center justify-center text-sm shadow-sm">
                            {peer.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-900 text-sm leading-tight">{peer.name}</h4>
                            <p className="text-[11px] text-gray-500">{peer.study_year} • {peer.department.split('&')[0].trim()}</p>
                          </div>
                        </div>

                        {conv.unread_count > 0 && (
                          <span className="bg-emerald-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full animate-pulse">
                            {conv.unread_count} new
                          </span>
                        )}
                      </div>

                      {conv.last_message && (
                        <div className="mt-3 p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-600 italic line-clamp-2">
                          &quot;{conv.last_message}&quot;
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 font-mono">
                        {conv.last_message_time ? conv.last_message_time.split(' ')[1]?.substring(0, 5) : ''}
                      </span>
                      <button
                        onClick={() => setActiveChatPeer(peer)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-sm flex items-center gap-1.5"
                      >
                        <span>💬</span>
                        <span>Open Chat</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CONNECTION REQUEST MODAL ────────────────────────────────────────── */}
      {targetStudentForRequest && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  Send Connection Request
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  To: <strong>{targetStudentForRequest.name}</strong> ({targetStudentForRequest.department})
                </p>
              </div>
              <button
                onClick={() => setTargetStudentForRequest(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {requestFeedback && (
              <div className={`p-3 rounded-xl text-xs ${
                requestFeedback.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                {requestFeedback.text}
              </div>
            )}

            <form onSubmit={handleSendRequestSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Intro Note (optional)
                </label>
                <textarea
                  rows={3}
                  maxLength={200}
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  placeholder="e.g. Hey, saw you're studying at Central Library! Want to team up?"
                  className="w-full rounded-xl border border-gray-300 p-2.5 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-[10px] text-gray-400 text-right mt-0.5">
                  {requestMessage.length}/200
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetStudentForRequest(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingRequest}
                  className="px-5 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {sendingRequest ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── PEER-TO-PEER CHAT MODAL ────────────────────────────────────── */}
      {activeChatPeer && (
        <PeerChatModal
          peer={activeChatPeer}
          currentProfileId={currentProfileId}
          onClose={() => {
            setActiveChatPeer(null)
            if (currentProfileId) loadConversationsData(currentProfileId)
          }}
        />
      )}
    </div>
  )
}
