/**
 * ML classifier for issue priority — TensorFlow.js feed-forward network.
 *
 * Architecture: 11 inputs → Dense(16, relu) → Dense(8, relu) → Dense(4, softmax)
 * Training:     200 synthetic examples generated from priority-engine rules.
 * Storage:      TF.js localstorage backend + metadata key.
 */

import { computePriority } from './priority-engine.js';

const MODEL_KEY    = 'localstorage://docfact-priority-model';
const META_KEY     = 'docfact_ml_meta';
const NUM_FEATURES = 11;
const NUM_CLASSES  = 4;

const PRIORITY_CLASSES = ['urgent', 'high', 'normal', 'low'];
const PRIORITY_INDEX   = { urgent: 0, high: 1, normal: 2, low: 3 };

const TYPE_INDEX = {
  time_arrival: 0, route_deviation: 1, missing_confirmation: 2,
  id_mismatch: 3,  geofence: 4,        weight_deviation: 5,
};

let _model = null;

// ── Feature extraction ─────────────────────────────────

export function extractFeatures(issue, tripCtx, openCountForTrip) {
  const now = new Date();

  // 1. criticality: CRIT=1, WARN=0
  const criticality = issue.severity === 'CRIT' ? 1.0 : 0.0;

  // 2. hours_to_deadline / 24, clamped [0,1]  (0 = past or no deadline)
  let hoursNorm = 0.0;
  if (tripCtx?.plannedArrival) {
    const hrs = (new Date(tripCtx.plannedArrival) - now) / 3_600_000;
    hoursNorm = Math.max(0.0, Math.min(1.0, hrs / 24.0));
  }

  // 3. trip raw status: completed/closed = 0, otherwise 0.5 (active proxy)
  const rs = (tripCtx?.rawStatus || '').toLowerCase();
  const tripStatusNorm = ['completed', 'closed', 'done'].includes(rs) ? 0.0 : 0.5;

  // 4. doc_status: draft = 1, else 0
  const docDraft = (tripCtx?.docStatus || '').toLowerCase() === 'draft' ? 1.0 : 0.0;

  // 5. issues_per_trip / 5, clamped [0,1]
  const issuesNorm = Math.min(1.0, openCountForTrip / 5.0);

  // 6. rule type — one-hot (6 features)
  const typeVec = [0, 0, 0, 0, 0, 0];
  const ti = TYPE_INDEX[issue.type];
  if (ti !== undefined) typeVec[ti] = 1.0;

  return [criticality, hoursNorm, tripStatusNorm, docDraft, issuesNorm, ...typeVec];
}

// ── Synthetic training data ────────────────────────────

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateSyntheticData(n = 200) {
  const types    = Object.keys(TYPE_INDEX);
  const features = [];
  const labels   = [];

  for (let i = 0; i < n; i++) {
    const severity    = Math.random() > 0.45 ? 'CRIT' : 'WARN';
    const type        = randomChoice(types);
    const docStatus   = randomChoice(['draft', 'agreed', 'agreed', 'signed', 'closed']);
    const rawStatus   = Math.random() > 0.25 ? 'active' : 'completed';
    const openCount   = Math.floor(Math.random() * 7);
    const issueStatus = randomChoice(['new', 'new', 'new', 'in_progress', 'confirmed', 'dismissed']);

    // Random arrival: 85% have one, spanning -8h … +28h from now
    let plannedArrival = null;
    if (Math.random() > 0.15) {
      const hoursOffset = (Math.random() * 36) - 8;
      plannedArrival = new Date(Date.now() + hoursOffset * 3_600_000).toISOString();
    }

    const synIssue = { type, severity, status: issueStatus };
    const synCtx   = { plannedArrival, docStatus, rawStatus };

    const { priority } = computePriority(synIssue, synCtx, openCount);

    features.push(extractFeatures(synIssue, synCtx, openCount));
    labels.push(PRIORITY_INDEX[priority] ?? 2);
  }

  return { features, labels };
}

// ── Model architecture ─────────────────────────────────

function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [NUM_FEATURES] }));
  model.add(tf.layers.dense({ units: 8,  activation: 'relu' }));
  model.add(tf.layers.dense({ units: NUM_CLASSES, activation: 'softmax' }));
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss:      'categoricalCrossentropy',
    metrics:   ['accuracy'],
  });
  return model;
}

// ── Training ───────────────────────────────────────────

export async function trainModel() {
  if (typeof tf === 'undefined') throw new Error('TensorFlow.js не загружен');

  const { features, labels } = generateSyntheticData(200);

  const xs = tf.tensor2d(features);
  const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), NUM_CLASSES).toFloat();

  const model = buildModel();
  await model.fit(xs, ys, { epochs: 30, batchSize: 32, shuffle: true, verbose: 0 });
  xs.dispose();
  ys.dispose();

  // Save to localStorage
  await model.save(MODEL_KEY);
  _model = model;

  // Evaluate accuracy on training set
  const xsEval   = tf.tensor2d(features);
  const predsOut = model.predict(xsEval);
  const predIdxs = predsOut.argMax(1).dataSync();
  xsEval.dispose();
  predsOut.dispose();

  const correct  = labels.filter((l, i) => l === predIdxs[i]).length;
  const accuracy = correct / labels.length;
  const numParams = model.countParams();

  const meta = {
    accuracy,
    numParams,
    trainedAt:       new Date().toISOString(),
    trainingSamples: 200,
    epochs:          30,
    architecture:    `${NUM_FEATURES} → Dense(16,relu) → Dense(8,relu) → Dense(${NUM_CLASSES},softmax)`,
  };
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}

  return meta;
}

// ── Load saved model at startup ────────────────────────

export async function initML() {
  if (typeof tf === 'undefined') return;
  try {
    _model = await tf.loadLayersModel(MODEL_KEY);
  } catch {
    _model = null;
  }
}

// ── Synchronous inference (call after initML resolves) ─

export function predictPriority(features) {
  if (!_model) return null;
  try {
    const inputT  = tf.tensor2d([features]);
    const outputT = _model.predict(inputT);
    const probs   = Array.from(outputT.dataSync());
    inputT.dispose();
    outputT.dispose();
    const maxIdx = probs.indexOf(Math.max(...probs));
    return {
      priority:      PRIORITY_CLASSES[maxIdx],
      probabilities: probs,
      confidence:    probs[maxIdx],
    };
  } catch {
    return null;
  }
}

// ── Status ─────────────────────────────────────────────

export function getMLStatus() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY));
    return { trained: !!(_model && meta), ...(meta || {}) };
  } catch {
    return { trained: false };
  }
}
