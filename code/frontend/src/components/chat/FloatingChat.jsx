import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import {
  QUICK_REPLY_CHIPS,
  validateChatMessage,
  getChatSessionStatusMeta,
  formatMessageTime,
  appendMessageDeduped,
} from '../../utils/chatHelpers.js';

export default function FloatingChat() {
  const { token, user } = useAuth();
  const { socket, status } = useSocket();

  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [inputError, setInputError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Load current session when chat panel is opened
  const loadChatSession = async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const data = await apiFetch('/chat/sessions/mine', { token });
      if (data.session) {
        setSession(data.session);
        setMessages(data.messages || []);
      } else {
        // If no session exists, create a new active one
        const initData = await apiFetch('/chat/sessions', {
          method: 'POST',
          token,
        });
        setSession(initData.session);
        setMessages([
          {
            id: 'welcome',
            sender: 'bot',
            text: 'Hello! I am Meridian Virtual Assistant. How can I help you today? Ask about your flights, baggage, check-in, parking, or airport facilities.',
            intent: 'greeting',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.warn('Could not load chat session:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Reload current session when chat panel is opened or socket status transitions
  useEffect(() => {
    if (isOpen && token) {
      loadChatSession();
    }
  }, [isOpen, token, status]);

  // Also listen directly for socket connect/reconnect to reload messages
  useEffect(() => {
    if (!socket) return;
    const handleReconnect = () => {
      if (isOpen && token) {
        loadChatSession();
      }
    };
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('connect', handleReconnect);
    };
  }, [socket, isOpen, token]);

  // Real-time socket listeners
  useEffect(() => {
    if (!socket || !user) return;

    function handleAgentMessage(payload) {
      if (String(payload.sessionId) === String(session?.id) || !session) {
        setMessages((prev) => appendMessageDeduped(prev, payload.message));
      }
    }

    function handleSessionClaimed(payload) {
      if (payload.session && (String(payload.session.id) === String(session?.id) || !session)) {
        setSession(payload.session);
      }
    }

    function handleSessionClosed(payload) {
      if (payload.session && (String(payload.session.id) === String(session?.id) || !session)) {
        setSession(payload.session);
      }
    }

    socket.on('chat:message', handleAgentMessage);
    socket.on('chat:claimed', handleSessionClaimed);
    socket.on('chat:closed', handleSessionClosed);

    return () => {
      socket.off('chat:message', handleAgentMessage);
      socket.off('chat:claimed', handleSessionClaimed);
      socket.off('chat:closed', handleSessionClosed);
    };
  }, [socket, user, session?.id]);

  // Send message handler
  const handleSendMessage = async (textToSend) => {
    const messageText = typeof textToSend === 'string' ? textToSend : inputText;
    const validation = validateChatMessage(messageText);

    if (!validation.isValid) {
      setInputError(validation.error);
      return;
    }

    setInputError(null);
    setInputText('');
    setSubmitting(true);

    try {
      // Ensure we have an open session
      let activeSession = session;
      if (!activeSession || activeSession.status === 'closed') {
        const initData = await apiFetch('/chat/sessions', { method: 'POST', token });
        activeSession = initData.session;
        setSession(activeSession);
      }

      const res = await apiFetch(`/chat/sessions/${activeSession.id}/messages`, {
        method: 'POST',
        token,
        body: { text: validation.trimmedText },
      });

      // Append user message and bot reply using deduplication helper
      setMessages((prev) => {
        let next = appendMessageDeduped(prev, res.userMessage);
        if (res.botMessage) {
          next = appendMessageDeduped(next, res.botMessage);
        }
        return next;
      });

      if (res.session) {
        setSession(res.session);
      }
    } catch (err) {
      setInputError(err.message || 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  // Close session action
  const handleCloseSession = async () => {
    if (!session || session.status === 'closed') return;
    try {
      const res = await apiFetch(`/chat/sessions/${session.id}/close`, {
        method: 'POST',
        token,
      });
      if (res.session) {
        setSession(res.session);
        setMessages((prev) => [
          ...prev,
          {
            id: `close-${Date.now()}`,
            sender: 'bot',
            text: 'This chat session has been closed. Click "Start New Chat" anytime you need help!',
            intent: 'session_closed',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.warn('Could not close session:', err.message);
    }
  };

  // Start new session
  const handleStartNewSession = async () => {
    try {
      const initData = await apiFetch('/chat/sessions', { method: 'POST', token });
      setSession(initData.session);
      setMessages([
        {
          id: `welcome-${Date.now()}`,
          sender: 'bot',
          text: 'Hello! I am Meridian Virtual Assistant. How can I help you today?',
          intent: 'greeting',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.warn('Could not start new session:', err.message);
    }
  };

  // Status metadata
  const statusMeta = getChatSessionStatusMeta(session?.status || 'active');

  // If user is not logged in, do not render chat
  if (!user) return null;

  return (
    <>
      {/* Floating Action Button */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close chat' : 'Open Meridian Assistant'}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, background-color 0.2s ease',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '26px' }}>
            {isOpen ? 'close' : 'support_agent'}
          </span>
        </button>
      </div>

      {/* Floating Chat Panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Meridian Assistant Chat"
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '24px',
            width: '390px',
            maxWidth: 'calc(100vw - 32px)',
            height: '540px',
            maxHeight: 'calc(100vh - 120px)',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 12px 36px rgba(15, 23, 42, 0.16)',
            border: '1px solid rgba(226, 232, 240, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9999,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  backgroundColor: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  smart_toy
                </span>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '14.5px', letterSpacing: '-0.01em' }}>
                  Meridian Assistant
                </div>
                <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor:
                        session?.status === 'escalated'
                          ? '#f59e0b'
                          : session?.status === 'assigned'
                          ? '#38bdf8'
                          : '#10b981',
                    }}
                  />
                  <span style={{ color: '#cbd5e1' }}>{statusMeta.label}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {session && session.status !== 'closed' && (
                <button
                  type="button"
                  onClick={handleCloseSession}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '11px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                  title="Close this chat session"
                >
                  End Chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Minimize chat"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  minimize
                </span>
              </button>
            </div>
          </div>

          {/* Escalation Banner */}
          {session?.status === 'escalated' && (
            <div
              style={{
                padding: '8px 14px',
                backgroundColor: '#fffbeb',
                color: '#b45309',
                borderBottom: '1px solid #fef3c7',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                support_agent
              </span>
              <span>Connecting with an airport support agent...</span>
            </div>
          )}

          {session?.status === 'assigned' && (
            <div
              style={{
                padding: '8px 14px',
                backgroundColor: '#f0f9ff',
                color: '#0369a1',
                borderBottom: '1px solid #e0f2fe',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                badge
              </span>
              <span>Support Agent is in the chat.</span>
            </div>
          )}

          {/* Messages Scroll View */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              backgroundColor: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {loadingHistory && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: '12.5px' }}>
                Loading conversation...
              </div>
            )}

            {messages.map((m, idx) => {
              const isUser = m.sender === 'user';
              const isAgent = m.sender === 'agent';
              const isSystem = m.intent === 'session_closed' || m.intent === 'agent_joined';

              if (isSystem) {
                return (
                  <div key={m.id || idx} style={{ textAlign: 'center', margin: '4px 0' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        backgroundColor: '#e2e8f0',
                        color: '#475569',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {m.text}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={m.id || idx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  {isAgent && (
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#0369a1', marginBottom: '2px', paddingLeft: '4px' }}>
                      Airport Support Agent
                    </div>
                  )}

                  <div
                    style={{
                      maxWidth: '85%',
                      padding: '10px 14px',
                      borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                      backgroundColor: isUser ? '#0284c7' : isAgent ? '#e0f2fe' : '#ffffff',
                      color: isUser ? '#ffffff' : '#0f172a',
                      border: isUser ? 'none' : isAgent ? '1px solid #bae6fd' : '1px solid #e2e8f0',
                      fontSize: '13px',
                      lineHeight: '1.45',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    {/* Render plain text only - never HTML */}
                    {m.text}
                  </div>

                  <span
                    style={{
                      fontSize: '10px',
                      color: '#94a3b8',
                      marginTop: '3px',
                      padding: isUser ? '0 4px 0 0' : '0 0 0 4px',
                    }}
                  >
                    {formatMessageTime(m.timestamp)}
                  </span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick-Reply Chips Row */}
          {session?.status !== 'closed' && (
            <div
              style={{
                padding: '6px 12px',
                borderTop: '1px solid #f1f5f9',
                backgroundColor: '#ffffff',
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {QUICK_REPLY_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleSendMessage(chip.query)}
                  disabled={submitting}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 9px',
                    borderRadius: '999px',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    color: '#334155',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '13px', color: '#0284c7' }}>
                    {chip.icon}
                  </span>
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* "Talk to a person" Action Button */}
          {session?.status === 'active' && (
            <div
              style={{
                padding: '4px 12px 6px',
                backgroundColor: '#ffffff',
                textAlign: 'right',
              }}
            >
              <button
                type="button"
                onClick={() => handleSendMessage('I would like to speak to a customer support agent.')}
                disabled={submitting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0284c7',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  person
                </span>
                <span>Talk to a person</span>
              </button>
            </div>
          )}

          {/* Input Footer */}
          <div
            style={{
              padding: '12px 14px',
              borderTop: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
            }}
          >
            {session?.status === 'closed' ? (
              <div style={{ textAlign: 'center', padding: '4px 0' }}>
                <button
                  type="button"
                  onClick={handleStartNewSession}
                  className="btn-primary-aero"
                  style={{ width: '100%', padding: '8px 16px', fontSize: '13px', fontWeight: 700 }}
                >
                  Start New Chat
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
              >
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder="Ask a question or flight #..."
                    maxLength={500}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '9px 40px 9px 12px',
                      borderRadius: '8px',
                      border: inputError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={submitting || !inputText.trim()}
                    style={{
                      position: 'absolute',
                      right: '6px',
                      background: 'none',
                      border: 'none',
                      color: inputText.trim() && !submitting ? '#0284c7' : '#cbd5e1',
                      cursor: inputText.trim() && !submitting ? 'pointer' : 'default',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Send message"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      send
                    </span>
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '4px',
                    fontSize: '10.5px',
                  }}
                >
                  <span style={{ color: inputError ? '#ef4444' : '#94a3b8' }}>
                    {inputError || `${inputText.length}/500`}
                  </span>
                  <span style={{ color: '#94a3b8' }}>Live airport assistant</span>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
