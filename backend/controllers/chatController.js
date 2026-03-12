const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');

let chatSchemaReady = false;
let chatSchemaPromise = null;

const streamClients = new Map(); // userId -> Set<res>

const ensureChatSchema = async () => {
  if (chatSchemaReady) return;
  if (chatSchemaPromise) return chatSchemaPromise;

  chatSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT,
        attachment_name VARCHAR(255),
        attachment_path TEXT,
        attachment_type VARCHAR(100),
        attachment_size BIGINT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      );
    `);

    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT;`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(100);`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;`);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_pair_time
      ON chat_messages(sender_id, recipient_id, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_unread
      ON chat_messages(recipient_id, is_read, created_at DESC);
    `);

    chatSchemaReady = true;
    chatSchemaPromise = null;
  })();

  return chatSchemaPromise;
};

const getOnlineUserIds = () => Array.from(streamClients.keys());

const addStreamClient = (userId, res) => {
  if (!streamClients.has(userId)) {
    streamClients.set(userId, new Set());
  }
  streamClients.get(userId).add(res);
};

const removeStreamClient = (userId, res) => {
  const set = streamClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    streamClients.delete(userId);
  }
};

const publishToUser = (userId, event, payload) => {
  const set = streamClients.get(userId);
  if (!set) return;
  for (const res of set) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
};

const publishToAll = (event, payload) => {
  for (const set of streamClients.values()) {
    for (const res of set) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }
};

const resolveUserFromToken = async (token) => {
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const result = await pool.query(
    'SELECT id, username, role, is_active FROM users WHERE id = $1',
    [decoded.userId]
  );
  if (result.rows.length === 0 || !result.rows[0].is_active) return null;
  return result.rows[0];
};

const normalizeMessage = (row) => ({
  ...row,
  attachment_url: row.attachment_path ? `/uploads/chat/${path.basename(row.attachment_path)}` : null
});

const getContacts = async (req, res) => {
  try {
    await ensureChatSchema();

    const onlineSet = new Set(getOnlineUserIds());

    const result = await pool.query(
      `SELECT id, username, email, role
       FROM users
       WHERE is_active = TRUE AND id <> $1
       ORDER BY username`,
      [req.user.id]
    );

    const contacts = result.rows.map((r) => ({
      ...r,
      is_online: onlineSet.has(r.id)
    }));

    res.json(contacts);
  } catch (error) {
    console.error('Error fetching chat contacts:', error);
    res.status(500).json({ error: error.message });
  }
};

const getOnlineUsers = async (req, res) => {
  try {
    await ensureChatSchema();
    res.json({ onlineUserIds: getOnlineUserIds() });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMessages = async (req, res) => {
  try {
    await ensureChatSchema();

    const { userId } = req.params;
    const { limit = 200 } = req.query;
    const parsedLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200));

    const result = await pool.query(
      `SELECT id, sender_id, recipient_id, content,
              attachment_name, attachment_path, attachment_type, attachment_size,
              is_read, created_at, read_at
       FROM chat_messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at ASC
       LIMIT $3`,
      [req.user.id, userId, parsedLimit]
    );

    await pool.query(
      `UPDATE chat_messages
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
       WHERE sender_id = $1 AND recipient_id = $2 AND is_read = FALSE`,
      [userId, req.user.id]
    );

    res.json(result.rows.map(normalizeMessage));
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    await ensureChatSchema();

    const { recipientId, content } = req.body;
    const normalizedRecipientId = (recipientId || '').toString().trim();
    const text = (content || '').toString().trim();
    const file = req.file || null;

    if (!normalizedRecipientId || (!text && !file)) {
      return res.status(400).json({ error: 'recipientId and either content or attachment are required' });
    }

    const recipientResult = await pool.query(
      'SELECT id, username, is_active FROM users WHERE id = $1',
      [normalizedRecipientId]
    );

    if (recipientResult.rows.length === 0 || !recipientResult.rows[0].is_active) {
      return res.status(404).json({ error: 'Recipient not found or inactive' });
    }

    const result = await pool.query(
      `INSERT INTO chat_messages (
         sender_id, recipient_id, content,
         attachment_name, attachment_path, attachment_type, attachment_size
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, sender_id, recipient_id, content,
                 attachment_name, attachment_path, attachment_type, attachment_size,
                 is_read, created_at, read_at`,
      [
        req.user.id,
        normalizedRecipientId,
        text || null,
        file ? file.originalname : null,
        file ? file.path : null,
        file ? file.mimetype : null,
        file ? file.size : null
      ]
    );

    const message = normalizeMessage(result.rows[0]);

    publishToUser(req.user.id, 'chat_message', message);
    publishToUser(normalizedRecipientId, 'chat_message', message);

    await logAudit(req.user.id, 'CHAT_MESSAGE_SENT', 'chat_messages', message.id, {}, { recipientId: normalizedRecipientId }, req);

    res.status(201).json({ message: 'Message sent', chat: message });
  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ error: error.message });
  }
};

const sendTyping = async (req, res) => {
  try {
    const { recipientId, isTyping } = req.body;
    if (!recipientId || typeof isTyping !== 'boolean') {
      return res.status(400).json({ error: 'recipientId and isTyping(boolean) are required' });
    }

    publishToUser(recipientId, 'chat_typing', {
      fromUserId: req.user.id,
      isTyping
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error sending typing status:', error);
    res.status(500).json({ error: error.message });
  }
};

const getUnreadCounts = async (req, res) => {
  try {
    await ensureChatSchema();

    const result = await pool.query(
      `SELECT sender_id, COUNT(*)::int AS unread_count
       FROM chat_messages
       WHERE recipient_id = $1 AND is_read = FALSE
       GROUP BY sender_id`,
      [req.user.id]
    );

    const counts = {};
    for (const row of result.rows) {
      counts[row.sender_id] = row.unread_count;
    }

    res.json({ counts });
  } catch (error) {
    console.error('Error fetching unread chat counts:', error);
    res.status(500).json({ error: error.message });
  }
};

const stream = async (req, res) => {
  try {
    await ensureChatSchema();

    const token = req.query.token;
    const user = await resolveUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized stream' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    addStreamClient(user.id, res);

    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ ok: true, userId: user.id })}\n\n`);

    publishToAll('chat_presence', {
      userId: user.id,
      isOnline: true,
      onlineUserIds: getOnlineUserIds()
    });

    const heartbeat = setInterval(() => {
      res.write('event: ping\n');
      res.write(`data: ${JSON.stringify({ t: Date.now() })}\n\n`);
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeStreamClient(user.id, res);
      publishToAll('chat_presence', {
        userId: user.id,
        isOnline: false,
        onlineUserIds: getOnlineUserIds()
      });
    });
  } catch (error) {
    console.error('Error opening chat stream:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getContacts,
  getOnlineUsers,
  getMessages,
  sendMessage,
  sendTyping,
  getUnreadCounts,
  stream
};
