import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationService } from '../services/api';

export default function NotificationIcon() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const prevCountRef = useRef(0);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    const loadUnreadCount = async () => {
      try {
        const res = await notificationService.getUnreadCount();
        const newCount = res.data.unreadCount;
        // play sound when unread increases
        if (newCount > prevCountRef.current) {
          try {
            if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = audioCtxRef.current;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(1000, ctx.currentTime);
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.01);
            o.connect(g);
            g.connect(ctx.destination);
            o.start();
            setTimeout(() => { o.stop(); }, 150);
          } catch (e) {
            // ignore audio errors
            console.error('Audio play error', e);
          }
        }
        prevCountRef.current = newCount;
        setUnreadCount(newCount);
      } catch (err) {
        console.error('Error loading unread count:', err);
      }
    };

    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleBellClick = async () => {
    setShowDropdown(!showDropdown);
    if (!showDropdown) {
      try {
        const res = await notificationService.getNotifications({ limit: 10 });
        setNotifications(res.data);
      } catch (err) {
        console.error('Error loading notifications:', err);
      }
    }
  };

  const navigate = useNavigate();

  const handleNotificationClick = async (notif) => {
    try {
      // Mark this notification as read
      await notificationService.markAsRead(notif.id);
      setNotifications(notifications.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      setUnreadCount(count => Math.max(0, count - (notif.is_read ? 0 : 1)));
    } catch (err) {
      console.error('Error marking notification read:', err);
    }

    // Try to navigate to the project if data contains projectId
    try {
      const data = typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data || {};
      if (data.projectId) {
        navigate(`/project/${data.projectId}`);
        setShowDropdown(false);
        return;
      }
    } catch (e) {
      console.error('Error parsing notification data:', e);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setUnreadCount(0);
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleBellClick}
        className="relative p-2 text-gray-600 hover:text-gray-900"
        title="Notifications"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl z-50">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold">Notifications ({unreadCount} unread)</h3>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllAsRead} className="text-sm text-blue-600 hover:text-blue-800">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-gray-500 text-center">No notifications</div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-3 border-b cursor-pointer ${notif.is_read ? 'bg-gray-50' : 'bg-blue-50'}`}
                >
                  <p className="text-sm font-medium">{notif.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{new Date(notif.created_at).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
