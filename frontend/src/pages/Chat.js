import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { chatService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString();
};

const toPublicUrl = (relativeOrAbsolute) => {
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const apiBase = process.env.REACT_APP_API_URL || '/api';
  const serverBase = apiBase.replace(/\/api\/?$/, '');
  return `${serverBase}${relativeOrAbsolute}`;
};

export default function Chat() {
  const { user } = useAuth();
  const location = useLocation();
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [messages, setMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingFrom, setTypingFrom] = useState({});
  const [draft, setDraft] = useState('');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const typingTimerRef = useRef(null);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) || null,
    [contacts, selectedContactId]
  );

  const loadContactsAndUnread = async () => {
    const [contactsRes, unreadRes, onlineRes] = await Promise.all([
      chatService.getContacts(),
      chatService.getUnreadCounts(),
      chatService.getOnlineUsers()
    ]);

    setContacts(contactsRes.data || []);
    setUnreadCounts(unreadRes.data?.counts || {});
    setOnlineUsers(new Set(onlineRes.data?.onlineUserIds || []));

    const targetId = new URLSearchParams(location.search).get('user');
    const hasTarget = targetId && (contactsRes.data || []).some((c) => c.id === targetId);
    const firstId = contactsRes.data?.[0]?.id;
    if (hasTarget) {
      setSelectedContactId(targetId);
    } else if (!selectedContactId && firstId) {
      setSelectedContactId(firstId);
    }
  };

  const loadMessages = async (contactId) => {
    if (!contactId) {
      setMessages([]);
      return;
    }

    const res = await chatService.getMessages(contactId);
    setMessages(res.data || []);

    setUnreadCounts((prev) => ({
      ...prev,
      [contactId]: 0
    }));
    window.dispatchEvent(new Event('chat:refreshUnread'));
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setLoading(true);
        await loadContactsAndUnread();
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load chat');
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [location.search]);

  useEffect(() => {
    loadMessages(selectedContactId).catch((err) => {
      setError(err.response?.data?.error || err.message || 'Failed to load messages');
    });
  }, [selectedContactId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const es = new EventSource(`/api/chat/stream?token=${encodeURIComponent(token)}`);

    const onMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const isCurrentThread =
          (msg.sender_id === selectedContactId && msg.recipient_id === user?.id) ||
          (msg.sender_id === user?.id && msg.recipient_id === selectedContactId);

        if (isCurrentThread) {
          setMessages((prev) => [...prev, msg]);
        }

        const otherId = msg.sender_id === user?.id ? msg.recipient_id : msg.sender_id;

        if (!isCurrentThread && msg.recipient_id === user?.id) {
          setUnreadCounts((prev) => ({
            ...prev,
            [otherId]: (prev[otherId] || 0) + 1
          }));
        }
      } catch (_) {
        // ignore malformed event
      }
    };

    const onTyping = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setTypingFrom((prev) => ({
          ...prev,
          [payload.fromUserId]: !!payload.isTyping
        }));
      } catch (_) {
        // ignore
      }
    };

    const onPresence = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (Array.isArray(payload.onlineUserIds)) {
          setOnlineUsers(new Set(payload.onlineUserIds));
        } else if (payload.userId) {
          setOnlineUsers((prev) => {
            const next = new Set(prev);
            if (payload.isOnline) next.add(payload.userId);
            else next.delete(payload.userId);
            return next;
          });
        }
      } catch (_) {
        // ignore
      }
    };

    es.addEventListener('chat_message', onMessage);
    es.addEventListener('chat_typing', onTyping);
    es.addEventListener('chat_presence', onPresence);

    return () => {
      es.removeEventListener('chat_message', onMessage);
      es.removeEventListener('chat_typing', onTyping);
      es.removeEventListener('chat_presence', onPresence);
      es.close();
    };
  }, [selectedContactId, user?.id]);

  const emitTyping = async (isTyping) => {
    if (!selectedContactId) return;
    try {
      await chatService.sendTyping({ recipientId: selectedContactId, isTyping });
    } catch (_) {
      // ignore typing errors
    }
  };

  const handleDraftChange = (value) => {
    setDraft(value);
    emitTyping(true);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      emitTyping(false);
    }, 1200);
  };

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

  const handleSend = async () => {
    const text = draft.trim();
    if (!selectedContactId || (!text && !attachmentFile)) return;

    try {
      setSending(true);
      setError('');

      const form = new FormData();
      form.append('recipientId', selectedContactId);
      if (text) form.append('content', text);
      if (attachmentFile) form.append('attachment', attachmentFile);

      await chatService.sendMessage(form);
      setDraft('');
      setAttachmentFile(null);
      await emitTyping(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading chat...</div>;
  }

  const selectedTyping = selectedContactId && typingFrom[selectedContactId];

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
        <h1 className="text-2xl font-bold text-gray-900">Chat</h1>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold">Users</div>
            <div className="max-h-[70vh] overflow-y-auto">
              {contacts.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">No users available</div>
              ) : (
                contacts.map((c) => {
                  const unread = unreadCounts[c.id] || 0;
                  const selected = c.id === selectedContactId;
                  const online = onlineUsers.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedContactId(c.id)}
                      className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${selected ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-gray-900">{c.username}</p>
                          <p className="text-xs text-gray-500">
                            {c.role} • {online ? 'Online' : 'Offline'}
                          </p>
                        </div>
                        {unread > 0 && (
                          <span className="min-w-[22px] rounded-full bg-red-600 px-2 py-0.5 text-center text-xs font-semibold text-white">
                            {unread}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white border rounded-lg overflow-hidden flex flex-col h-[70vh]">
            <div className="px-4 py-3 border-b font-semibold">
              {selectedContact ? `Chat with ${selectedContact.username}` : 'Select a user'}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {messages.length === 0 ? (
                <p className="text-sm text-gray-500">No messages yet</p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-blue-600 text-white' : 'bg-white border text-gray-900'}`}>
                        {m.content ? <p className="whitespace-pre-wrap">{m.content}</p> : null}
                        {m.attachment_url ? (
                          <a
                            href={toPublicUrl(m.attachment_url)}
                            target="_blank"
                            rel="noreferrer"
                            className={`mt-1 block underline ${mine ? 'text-blue-100' : 'text-blue-600'}`}
                          >
                            {m.attachment_name || 'Attachment'}
                          </a>
                        ) : null}
                        <p className={`mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-gray-500'}`}>{formatDateTime(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })
              )}
              {selectedTyping && (
                <p className="text-xs text-gray-500">{selectedContact?.username} is typing...</p>
              )}
            </div>

            <div className="p-3 border-t bg-white">
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={selectedContact ? 'Type a message...' : 'Select a user to start chat'}
                  disabled={!selectedContact || sending}
                  className="flex-1 border rounded-md px-3 py-2 text-sm"
                />
                <input
                  type="file"
                  disabled={!selectedContact || sending}
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                  className="text-sm"
                />
                <button
                  onClick={handleSend}
                  disabled={!selectedContact || (!draft.trim() && !attachmentFile) || sending}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
              {attachmentFile && <p className="mt-1 text-xs text-gray-600">Attached: {attachmentFile.name}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
