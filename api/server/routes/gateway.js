const express = require('express');
const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware/');
const checkAdmin = require('~/server/middleware/roles/admin');

/**
 * Gateway dashboard API.
 *
 * "Gateway" = the LiteLLM proxy this LibreChat instance routes through. These
 * routes read LiteLLM's admin API *server-side* so the master key never reaches
 * the browser, and they're admin-only because spend/keys/logs are sensitive.
 */
const router = express.Router();

// Container-to-container on the Pi; override with LITELLM_BASE_URL if needed.
const LITELLM_BASE_URL = (process.env.LITELLM_BASE_URL || 'http://litellm:4000').replace(
  /\/+$/,
  '',
);
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY;

const litellm = axios.create({
  baseURL: LITELLM_BASE_URL,
  timeout: 15000,
  headers: LITELLM_MASTER_KEY ? { Authorization: `Bearer ${LITELLM_MASTER_KEY}` } : {},
});

/** Thin proxy: forward LiteLLM's JSON, normalize failures to a stable shape. */
async function proxy(res, path, params) {
  if (!LITELLM_MASTER_KEY) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'LITELLM_MASTER_KEY is not set on the LibreChat server.',
    });
  }
  try {
    const { data } = await litellm.get(path, { params });
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    logger.error(`[gateway] GET ${path} -> ${status}: ${err.message}`);
    return res.status(status).json({
      error: 'litellm_error',
      path,
      message: err.response?.data?.error?.message || err.response?.data?.detail || err.message,
    });
  }
}

// Admin-only for everything below.
router.use(requireJwtAuth, checkAdmin);

// Per-deployment health — LiteLLM pings each provider/model.
router.get('/health', (req, res) => proxy(res, '/health'));

// Configured models + their (LiteLLM-sanitized) params, for the model cards.
router.get('/models', (req, res) => proxy(res, '/model/info'));

// Spend aggregates for the usage charts.
router.get('/spend', (req, res) => proxy(res, '/global/spend'));
router.get('/spend/report', (req, res) => proxy(res, '/global/spend/report', req.query));

// Recent request logs (mirrors LiteLLM's own Logs tab).
router.get('/logs', (req, res) => proxy(res, '/spend/logs', req.query));

// Virtual keys + their budgets/spend.
router.get('/keys', (req, res) => proxy(res, '/key/list', req.query));

module.exports = router;
