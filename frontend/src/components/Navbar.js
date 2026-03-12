import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiLogOut, FiHome, FiSettings, FiEdit3, FiMessageSquare, FiFileText } from 'react-icons/fi';
import NotificationIcon from './NotificationIcon';
import { chatService } from '../services/api';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [chatUnreadCounts, setChatUnreadCounts] = useState({});
  const [chatContacts, setChatContacts] = useState([]);
  const [popupMessage, setPopupMessage] = useState(null);
  const audioCtxRef = useRef(null);
  const popupTimerRef = useRef(null);

  const totalChatUnread = useMemo(
    () => Object.values(chatUnreadCounts).reduce((sum, n) => sum + (Number(n) || 0), 0),
    [chatUnreadCounts]
  );

  const refreshUnreadCounts = async () => {
    if (!user) return;
    try {
      const res = await chatService.getUnreadCounts();
      setChatUnreadCounts(res.data?.counts || {});
    } catch (_) {
      // ignore unread refresh errors
    }
  };

  const refreshContacts = async () => {
    if (!user) return;
    try {
      const res = await chatService.getContacts();
      setChatContacts(res.data || []);
    } catch (_) {
      // ignore contacts refresh errors
    }
  };

  const playIncomingMessageSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.22);
    } catch (_) {
      // ignore audio errors
    }
  };

  useEffect(() => {
    refreshUnreadCounts();
    refreshContacts();
  }, [user?.id, location.pathname]);

  useEffect(() => {
    if (!user) return;

    const onRefreshUnread = () => refreshUnreadCounts();
    const onWindowFocus = () => refreshUnreadCounts();

    window.addEventListener('chat:refreshUnread', onRefreshUnread);
    window.addEventListener('focus', onWindowFocus);

    const token = localStorage.getItem('token');
    if (!token) {
      return () => {
        window.removeEventListener('chat:refreshUnread', onRefreshUnread);
        window.removeEventListener('focus', onWindowFocus);
      };
    }

    const es = new EventSource(`/api/chat/stream?token=${encodeURIComponent(token)}`);
    const onMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.recipient_id === user.id && msg.sender_id !== user.id) {
          setChatUnreadCounts((prev) => ({
            ...prev,
            [msg.sender_id]: (prev[msg.sender_id] || 0) + 1
          }));
          playIncomingMessageSound();
          if (location.pathname !== '/chat') {
            const senderName = chatContacts.find((c) => c.id === msg.sender_id)?.username || 'New message';
            setPopupMessage({
              senderId: msg.sender_id,
              senderName,
              content: msg.content || (msg.attachment_name ? `Attachment: ${msg.attachment_name}` : 'New message')
            });
          }
        }
      } catch (_) {
        // ignore malformed events
      }
    };
    es.addEventListener('chat_message', onMessage);

    const poll = setInterval(() => refreshUnreadCounts(), 30000);

    return () => {
      clearInterval(poll);
      es.removeEventListener('chat_message', onMessage);
      es.close();
      window.removeEventListener('chat:refreshUnread', onRefreshUnread);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [user?.id, location.pathname, chatContacts]);

  useEffect(() => {
    if (!popupMessage) return;
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    popupTimerRef.current = setTimeout(() => setPopupMessage(null), 8000);
    return () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
  }, [popupMessage]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderRoleMenu = () => {
    switch (user?.role) {
      case 'admin':
        return (
          <>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
            >
              <FiHome /> <span>Dashboard</span>
            </button>
            <button
              onClick={() => navigate('/admin')}
              className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
            >
              <FiSettings /> <span>Admin Panel</span>
            </button>
          </>
        );
      case 'finance':
        return (
          <>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
            >
              <FiHome /> <span>Dashboard</span>
            </button>
            <button
              onClick={() => navigate('/project/new')}
              className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
            >
                <FiEdit3 /> <span>New Project</span>
              </button>
            <button
              onClick={() => navigate('/finance/invoices')}
              className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
            >
              <FiFileText /> <span>Invoice Tracker</span>
            </button>
          </>
        );
      case 'pmo':
        return (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
          >
            <FiHome /> <span>Dashboard</span>
          </button>
        );
      case 'manager':
        return (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
          >
            <FiHome /> <span>Dashboard</span>
          </button>
        );
      case 'auditor':
        return (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
          >
            <FiHome /> <span>Dashboard</span>
          </button>
        );
      default:
        return (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-700 hover:text-blue-600 flex items-center space-x-1"
          >
            <FiHome /> <span>Dashboard</span>
          </button>
        );
    }
  };

  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold text-blue-600">PMO Portal</h1>
            <div className="ml-10 flex space-x-8">
              {renderRoleMenu()}
              <button
                onClick={() => navigate('/chat')}
                className="relative text-gray-700 hover:text-blue-600 flex items-center space-x-1"
              >
                <FiMessageSquare /> <span>Chat</span>
                {totalChatUnread > 0 && (
                  <span className="absolute -top-2 -right-5 min-w-[20px] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white">
                    {totalChatUnread > 99 ? '99+' : totalChatUnread}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <NotificationIcon />
            <span className="text-sm text-gray-700">
              {user?.username} <span className="text-gray-500">({user?.role})</span>
            </span>
            <button
              onClick={handleLogout}
              className="text-gray-700 hover:text-red-600 flex items-center space-x-1"
              title="Logout"
            >
              <FiLogOut /> <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
      {popupMessage && (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{popupMessage.senderName}</p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-600">{popupMessage.content}</p>
            </div>
            <button
              onClick={() => setPopupMessage(null)}
              className="text-xs text-slate-500 hover:text-slate-700"
              title="Close"
            >
              x
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => {
                navigate(`/chat?user=${encodeURIComponent(popupMessage.senderId)}`);
                setPopupMessage(null);
              }}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Open Chat
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
