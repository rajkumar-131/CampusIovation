import { useState, useEffect, useRef } from 'react'
import { fetchPeerMessages, sendPeerMessage } from '../api'

const QUICK_STARTERS = [
  'Hey! Up for studying together? 📚',
  'Want to grab coffee at the cafeteria? ☕',
  'Heading over to the library now! 🚶',
  'Brainstorming campus green ideas 🌱',
]

export default function PeerChatModal({ connection, currentProfileId, onClose }) {
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)

  const peer = connection.peer_profile
  const connectionId = connection.connection_id

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }

  // Poll for messages every 2.5 seconds
  useEffect(() => {
    let isMounted = true

    const loadMessages = async (initial = false) => {
      try {
        const data = await fetchPeerMessages(connectionId, currentProfileId)
        if (isMounted) {
          setMessages(prev => {
            if (prev.length !== data.length || (data.length > 0 && prev[prev.length - 1]?.id !== data[data.length - 1]?.id)) {
              setTimeout(() => scrollToBottom(true), 50)
            }
            return data
          })
          if (initial) setLoading(false)
        }
      } catch (err) {
        if (isMounted && initial) {
          setError(err.message || 'Could not load chat messages')
          setLoading(false)
        }
      }
    }

    loadMessages(true)
    const interval = setInterval(() => loadMessages(false), 2500)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [connectionId, currentProfileId])

  const handleSend = async (textToSend) => {
    const text = (textToSend || inputText).trim()
    if (!text || sending) return

    setSending(true)
    setInputText('')
    setError(null)

    try {
      const newMsg = await sendPeerMessage(connectionId, currentProfileId, text)
      setMessages(prev => [...prev, newMsg])
      setTimeout(() => scrollToBottom(true), 50)
    } catch (err) {
      setError(err.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg h-[620px] max-h-[90vh] shadow-2xl border border-gray-200/80 flex flex-col overflow-hidden">
        {/* Chat Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 via-teal-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 text-white font-extrabold text-base flex items-center justify-center shadow-md shadow-emerald-500/20">
              {peer.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900 text-sm">{peer.name}</h3>
                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Connected Peer
                </span>
              </div>
              <p className="text-[11px] text-gray-500">
                {peer.study_year} • {peer.department}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-all text-sm font-bold"
            title="Close Chat"
          >
            ✕
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-gray-50/50">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
              <span className="animate-spin text-2xl">🌿</span>
              <p className="text-xs font-semibold">Connecting peer channel...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400 space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl shadow-xs">
                💬
              </div>
              <div>
                <h4 className="font-bold text-gray-700 text-sm">Say hello to {peer.name}!</h4>
                <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
                  You are mutually connected on Campus Connect. Plan a meetup or break the ice below.
                </p>
              </div>

              {/* Starter chips */}
              <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                {QUICK_STARTERS.map((starter, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(starter)}
                    className="text-[11px] bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-50 px-2.5 py-1.5 rounded-xl font-medium transition shadow-2xs"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) => {
                const isMine = m.sender_id === parseInt(currentProfileId, 10)
                const time = m.created_at ? m.created_at.split(' ')[1]?.substring(0, 5) || '' : ''

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs shadow-2xs leading-relaxed break-words ${
                        isMine
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-br-xs'
                          : 'bg-white border border-gray-200 text-gray-800 rounded-bl-xs'
                      }`}
                    >
                      {m.content}
                    </div>
                    <div className="flex items-center gap-1 px-1 mt-0.5 text-[10px] text-gray-400 font-mono">
                      <span>{time}</span>
                      {isMine && <span>{m.is_read ? '✓✓' : '✓'}</span>}
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Quick Starters toolbar when thread is active */}
        {messages.length > 0 && (
          <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">
              Quick:
            </span>
            {QUICK_STARTERS.slice(0, 3).map((starter, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(starter)}
                className="flex-shrink-0 text-[10px] bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2 py-0.5 rounded-lg transition"
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="px-4 py-1.5 bg-red-50 text-red-600 text-[11px] font-medium border-t border-red-100 flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="font-bold">✕</button>
          </div>
        )}

        {/* Input Bar */}
        <div className="p-3 bg-white border-t border-gray-100 flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${peer.name.split(' ')[0]}...`}
            disabled={sending}
            maxLength={1000}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
          />
          <button
            onClick={() => handleSend()}
            disabled={!inputText.trim() || sending}
            className="w-10 h-10 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 text-white flex items-center justify-center transition shadow-md shadow-emerald-600/20 flex-shrink-0"
            title="Send message (Enter)"
          >
            {sending ? (
              <span className="animate-spin text-sm">⌛</span>
            ) : (
              <svg className="w-4 h-4 transform rotate-90" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
