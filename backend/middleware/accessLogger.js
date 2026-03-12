const { logAccess } = require('./logger');

const accessLogger = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    // Skip health checks to reduce noise.
    if (req.originalUrl === '/api/health') return;

    const userId = req.user?.id || null;
    const endpoint = req.originalUrl || req.url;
    const method = req.method;
    const statusCode = res.statusCode;

    // Include duration in endpoint metadata for easier traceability.
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const endpointWithTiming = `${endpoint} (${durationMs.toFixed(2)}ms)`;

    logAccess(userId, endpointWithTiming, method, statusCode, req).catch(() => {});
  });

  next();
};

module.exports = accessLogger;
