import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import {
  validateChatMessage,
  getChatSessionStatusMeta,
  formatMessageTime,
  appendMessageDeduped,
} from '../../utils/chatHelpers.js';

export default function SupportConsole() {
  const { token, user } = useAuth();
  const { socket } = useSocket();

  // Queue state
  const [activeTab, setActiveTab] = useState('waiting'); // 'waiting', 'my_active', 'all'
  const [escalations, setEscalations] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState(null);

  // Selected session transcript
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Agent reply input
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState(null);
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Action status
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load escalations queue
  const loadEscalations = async () => {
    if (!token) return;
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const data = await apiFetch('/chat/escalations?limit=100', { token });
      setEscalations(data.escalations || []);
    } catch (err) {
      setQueueError(err.message || 'Could not load escalated chats');
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    loadEscalations();
  }, [token]);

  // Load session messages when selected
  const loadSessionTranscript = async (sId) => {
    if (!token || !sId) return;
    setLoadingMessages(true);
    setActionError(null);
    try {
      const data = await apiFetch(`/chat/sessions/${sId}`, { token });
      setSelectedSession(data.session);
      setMessages(data.messages || []);
    } catch (err) {
      setActionError(err.message || 'Could not load conversation details');
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionTranscript(selectedSessionId);
    }
  }, [selectedSessionId, token]);

  // Real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    function handleEscalated() {
      loadEscalations();
    }

    function handleClaimed(payload) {
      loadEscalations();
      if (payload.session && payload.session.id === selectedSessionId) {
        setSelectedSession(payload.session);
      }
    }

    function handleUserMsg(payload) {
      loadEscalations();
      if (String(payload.sessionId) === String(selectedSessionId)) {
        setMessages((prev) => appendMessageDeduped(prev, payload.userMessage));
      }
    }

    function handleAgentMsg(payload) {
      loadEscalations();
      if (String(payload.sessionId) === String(selectedSessionId)) {
        setMessages((prev) => appendMessageDeduped(prev, payload.message));
      }
    }

    function handleClosed(payload) {
      loadEscalations();
      if (payload.session && String(payload.session.id) === String(selectedSessionId)) {
        setSelectedSession(payload.session);
      }
    }

    socket.on('chat:escalated', handleEscalated);
    socket.on('chat:claimed', handleClaimed);
    socket.on('chat:user_message', handleUserMsg);
    socket.on('chat:agent_message', handleAgentMsg);
    socket.on('chat:closed', handleClosed);

    return () => {
      socket.off('chat:escalated', handleEscalated);
      socket.off('chat:claimed', handleClaimed);
      socket.off('chat:user_message', handleUserMsg);
      socket.off('chat:agent_message', handleAgentMsg);
      socket.off('chat:closed', handleClosed);
    };
  }, [socket, selectedSessionId]);

  // Filter sessions according to activeTab
  const filteredQueue = escalations.filter((s) => {
    if (activeTab === 'waiting') {
      return s.status === 'escalated';
    }
    if (activeTab === 'my_active') {
      return s.status === 'assigned' && s.assigned_agent_id === user?.id;
    }
    return true; // 'all'
  });

  const waitingCount = escalations.filter((s) => s.status === 'escalated').length;
  const myActiveCount = escalations.filter((s) => s.status === 'assigned' && s.assigned_agent_id === user?.id).length;

  // Claim Session Handler
  const handleClaimSession = async () => {
    if (!selectedSessionId) return;
    setBusyAction(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/chat/sessions/${selectedSessionId}/claim`, {
        method: 'POST',
        token,
      });
      setSelectedSession(res.session);
      setActionSuccess('Session claimed successfully! You are now the assigned agent.');
      loadEscalations();
      loadSessionTranscript(selectedSessionId);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setActionError(err.message || 'Could not claim chat session');
    } finally {
      setBusyAction(false);
    }
  };

  // Close Session Handler
  const handleCloseSession = async () => {
    if (!selectedSessionId) return;
    setBusyAction(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/chat/sessions/${selectedSessionId}/close`, {
        method: 'POST',
        token,
      });
      setSelectedSession(res.session);
      setActionSuccess('Chat session closed.');
      loadEscalations();
      loadSessionTranscript(selectedSessionId);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setActionError(err.message || 'Could not close chat session');
    } finally {
      setBusyAction(false);
    }
  };

  // Send Agent Reply Handler
  const handleSendAgentReply = async (e) => {
    e.preventDefault();
    if (!selectedSessionId) return;

    const validation = validateChatMessage(replyText);
    if (!validation.isValid) {
      setReplyError(validation.error);
      return;
    }

    setReplyError(null);
    setReplySubmitting(true);

    try {
      const res = await apiFetch(`/chat/sessions/${selectedSessionId}/agent-message`, {
        method: 'POST',
        token,
        body: { text: validation.trimmedText },
      });

      setMessages((prev) => appendMessageDeduped(prev, res.message));
      setReplyText('');
    } catch (err) {
      setReplyError(err.message || 'Could not send agent message');
    } finally {
      setReplySubmitting(false);
    }
  };

  const isAssignedToMe = selectedSession?.assigned_agent_id === user?.id;
  const isPrivileged = user?.role === 'admin' || user?.role === 'ops_manager';
  const canReply = selectedSession?.status === 'assigned' && (isAssignedToMe || isPrivileged);

  return (
    <div>
      {/* Console Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '26px', color: 'var(--color-primary, #0284c7)' }}
          >
            support_agent
          </span>
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--color-on-surface, #0f172a)',
              margin: 0,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-display, sans-serif)',
            }}
          >
            Passenger Support &amp; Escalations
          </h1>
        </div>
        <p style={{ margin: '4px 0 0 0', fontSize: '13.5px', color: '#64748b' }}>
          Respond to escalated passenger inquiries, claim waiting support sessions, and view live chat transcripts.
        </p>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#ecfdf5',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            check_circle
          </span>
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            error
          </span>
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: '20px',
          minHeight: '620px',
        }}
      >
        {/* Left Column: Queue List */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid rgba(226, 232, 240, 0.95)',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Queue Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('waiting')}
              style={{
                flex: 1,
                padding: '12px 8px',
                border: 'none',
                borderBottom: activeTab === 'waiting' ? '2px solid #0284c7' : '2px solid transparent',
                backgroundColor: activeTab === 'waiting' ? '#ffffff' : 'transparent',
                fontWeight: activeTab === 'waiting' ? 800 : 600,
                color: activeTab === 'waiting' ? '#0284c7' : '#64748b',
                fontSize: '12.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>Waiting</span>
              {waitingCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                  }}
                >
                  {waitingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('my_active')}
              style={{
                flex: 1,
                padding: '12px 8px',
                border: 'none',
                borderBottom: activeTab === 'my_active' ? '2px solid #0284c7' : '2px solid transparent',
                backgroundColor: activeTab === 'my_active' ? '#ffffff' : 'transparent',
                fontWeight: activeTab === 'my_active' ? 800 : 600,
                color: activeTab === 'my_active' ? '#0284c7' : '#64748b',
                fontSize: '12.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>My Active</span>
              {myActiveCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                  }}
                >
                  {myActiveCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('all')}
              style={{
                flex: 1,
                padding: '12px 8px',
                border: 'none',
                borderBottom: activeTab === 'all' ? '2px solid #0284c7' : '2px solid transparent',
                backgroundColor: activeTab === 'all' ? '#ffffff' : 'transparent',
                fontWeight: activeTab === 'all' ? 800 : 600,
                color: activeTab === 'all' ? '#0284c7' : '#64748b',
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              All Chats
            </button>
          </div>

          {/* Sessions List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {loadingQueue && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: '13px' }}>
                Loading escalations...
              </div>
            )}

            {!loadingQueue && filteredQueue.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: '#64748b' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#cbd5e1' }}>
                  inbox
                </span>
                <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '6px' }}>No sessions in queue</div>
                <div style={{ fontSize: '12px', marginTop: '2px' }}>
                  {activeTab === 'waiting'
                    ? 'All escalated requests have been claimed.'
                    : activeTab === 'my_active'
                    ? 'You have no active claimed conversations.'
                    : 'No support sessions found.'}
                </div>
              </div>
            )}

            {filteredQueue.map((s) => {
              const isSelected = s.id === selectedSessionId;
              const isEscalated = s.status === 'escalated';
              const statusMeta = getChatSessionStatusMeta(s.status);

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: isSelected ? '1px solid #0284c7' : '1px solid #e2e8f0',
                    backgroundColor: isSelected ? '#f0f9ff' : '#ffffff',
                    cursor: 'pointer',
                    marginBottom: '8px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
                      {s.passenger_name || 'Passenger'}
                    </div>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '10.5px',
                        fontWeight: 800,
                        backgroundColor: statusMeta.bgColor,
                        color: statusMeta.color,
                        border: `1px solid ${statusMeta.borderColor}`,
                        textTransform: 'uppercase',
                      }}
                    >
                      {s.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                    {s.passenger_email}
                  </div>

                  {s.last_message_text && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#334155',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.last_message_text}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '6px',
                      fontSize: '10.5px',
                      color: '#94a3b8',
                    }}
                  >
                    <span>ID #{s.id}</span>
                    <span>{formatMessageTime(s.last_message_time || s.updated_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Active Conversation Transcript */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid rgba(226, 232, 240, 0.95)',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {selectedSession ? (
            <>
              {/* Conversation Top Header */}
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: '#f8fafc',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '16px', color: '#0f172a' }}>
                      {selectedSession.passenger_name || 'Passenger'}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ({selectedSession.passenger_email || `User #${selectedSession.user_id}`})
                    </span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                    Session #{selectedSession.id} • Status: <strong>{selectedSession.status.toUpperCase()}</strong>
                    {selectedSession.agent_name && ` • Agent: ${selectedSession.agent_name}`}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedSession.status === 'escalated' && (
                    <button
                      type="button"
                      onClick={handleClaimSession}
                      disabled={busyAction}
                      className="btn-primary-aero"
                      style={{
                        padding: '6px 14px',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        pan_tool
                      </span>
                      <span>Claim Chat</span>
                    </button>
                  )}

                  {selectedSession.status !== 'closed' && (
                    <button
                      type="button"
                      onClick={handleCloseSession}
                      disabled={busyAction}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        color: '#dc2626',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Close Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Message Transcript */}
              <div
                style={{
                  flex: 1,
                  padding: '20px',
                  overflowY: 'auto',
                  backgroundColor: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {loadingMessages && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
                    Loading transcript...
                  </div>
                )}

                {messages.map((m, idx) => {
                  const isUser = m.sender === 'user';
                  const isAgent = m.sender === 'agent';
                  const isBot = m.sender === 'bot';

                  return (
                    <div
                      key={m.id || idx}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isAgent ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          marginBottom: '2px',
                          color: isAgent ? '#0284c7' : isUser ? '#334155' : '#64748b',
                        }}
                      >
                        {isAgent ? 'Support Agent (You)' : isUser ? 'Passenger' : 'Virtual Bot'}
                      </div>

                      <div
                        style={{
                          maxWidth: '80%',
                          padding: '10px 14px',
                          borderRadius: isAgent ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          backgroundColor: isAgent ? '#0284c7' : isUser ? '#ffffff' : '#f1f5f9',
                          color: isAgent ? '#ffffff' : '#0f172a',
                          border: isAgent ? 'none' : '1px solid #e2e8f0',
                          fontSize: '13px',
                          lineHeight: '1.45',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {/* Plain text only - never HTML */}
                        {m.text}
                      </div>

                      <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>
                        {formatMessageTime(m.timestamp)}
                      </span>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Agent Reply Box */}
              <div
                style={{
                  padding: '16px 20px',
                  borderTop: '1px solid #e2e8f0',
                  backgroundColor: '#ffffff',
                }}
              >
                {selectedSession.status === 'closed' ? (
                  <div style={{ textAlign: 'center', color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>
                    This chat session is closed. No further messages can be sent.
                  </div>
                ) : selectedSession.status === 'escalated' ? (
                  <div style={{ textAlign: 'center', padding: '6px 0' }}>
                    <span style={{ fontSize: '13px', color: '#64748b', marginRight: '12px' }}>
                      Session is waiting in queue. Claim it to respond to the passenger.
                    </span>
                    <button
                      type="button"
                      onClick={handleClaimSession}
                      disabled={busyAction}
                      className="btn-primary-aero"
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      Claim Now
                    </button>
                  </div>
                ) : canReply ? (
                  <form onSubmit={handleSendAgentReply}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => {
                          setReplyText(e.target.value);
                          if (replyError) setReplyError(null);
                        }}
                        placeholder="Type reply to passenger..."
                        maxLength={500}
                        disabled={replySubmitting}
                        style={{
                          flex: 1,
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: replyError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                          fontSize: '13px',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={replySubmitting || !replyText.trim()}
                        className="btn-primary-aero"
                        style={{
                          padding: '10px 18px',
                          fontSize: '13px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                          send
                        </span>
                        <span>{replySubmitting ? 'Sending...' : 'Send'}</span>
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '4px',
                        fontSize: '10.5px',
                      }}
                    >
                      <span style={{ color: replyError ? '#ef4444' : '#94a3b8' }}>
                        {replyError || `${replyText.length}/500`}
                      </span>
                      <span style={{ color: '#94a3b8' }}>Responding as Airport Agent</span>
                    </div>
                  </form>
                ) : (
                  <div style={{ textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                    Session is assigned to {selectedSession.agent_name || 'another agent'}.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                padding: '40px',
                textAlign: 'center',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#cbd5e1' }}>
                chat
              </span>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#475569', marginTop: '12px' }}>
                No Conversation Selected
              </div>
              <p style={{ fontSize: '13px', maxWidth: '320px', margin: '4px 0 0 0' }}>
                Select an escalated or active session from the left queue to view the transcript and communicate with the passenger.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
