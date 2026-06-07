import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.SOLVEWATCH_DB_PATH = ':memory:';

const { SessionService } = await import('../src/services/session.service.js');
const { SessionController } = await import('../src/controllers/session.controller.js');
const { createSessionRouter } = await import('../src/routes/session.routes.js');

async function createTestServer() {
  const service = new SessionService({ dbPath: ':memory:' });
  const controller = new SessionController(service);
  const app = express();
  app.use(express.json());
  app.use('/api', createSessionRouter(controller));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    service,
    baseUrl,
    close: async () => {
      await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      service.close();
    },
  };
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

test('POST /api/sessions creates a session', async () => {
  const server = await createTestServer();
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Backend interview',
        company: 'ExampleCorp',
        role: 'Backend Engineer',
        metadata: { source: 'route-test' },
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.session.title, 'Backend interview');
    assert.equal(body.session.company, 'ExampleCorp');
    assert.equal(body.session.role, 'Backend Engineer');
    assert.deepEqual(body.session.metadata, { source: 'route-test' });
  } finally {
    await server.close();
  }
});

test('GET /api/sessions lists created sessions', async () => {
  const server = await createTestServer();
  try {
    await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'First' }),
    });
    await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Second' }),
    });

    const { response, body } = await jsonRequest(server.baseUrl, '/api/sessions?limit=1&offset=0');

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].title, 'Second');
    assert.deepEqual(body.pagination, { limit: 1, offset: 0, total: 2 });
  } finally {
    await server.close();
  }
});

test('GET /api/sessions/:id returns one session', async () => {
  const server = await createTestServer();
  try {
    const created = await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Fetch me' }),
    });
    const id = created.body.session.id;

    const { response, body } = await jsonRequest(server.baseUrl, `/api/sessions/${id}`);

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.session.id, id);
    assert.equal(body.session.title, 'Fetch me');
  } finally {
    await server.close();
  }
});

test('GET /api/sessions/:id returns 404 for missing session', async () => {
  const server = await createTestServer();
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/api/sessions/missing-session');

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.match(body.error, /not found/);
  } finally {
    await server.close();
  }
});

test('Session routes validate invalid input', async () => {
  const server = await createTestServer();
  try {
    const invalidCreate = await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ metadata: [] }),
    });
    assert.equal(invalidCreate.response.status, 400);
    assert.equal(invalidCreate.body.success, false);

    const invalidList = await jsonRequest(server.baseUrl, '/api/sessions?limit=0');
    assert.equal(invalidList.response.status, 400);
    assert.equal(invalidList.body.success, false);
  } finally {
    await server.close();
  }
});

test('GET /api/sessions/:id/turns returns turns for a session', async () => {
  const server = await createTestServer();
  try {
    // Create a session
    const created = await jsonRequest(server.baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Turns test' }),
    });
    const sessionId = created.body.session.id;

    // Add turns directly via service
    server.service.appendTurn(sessionId, {
      raw_transcript: 'What is Redis?',
      cleaned_question: 'Explain Redis',
      answer: 'Redis is a cache.',
      provider: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      latency_ms: 500,
    });
    server.service.appendTurn(sessionId, {
      raw_transcript: 'What is Node.js?',
      cleaned_question: 'Explain Node.js',
      answer: 'Node.js is a runtime.',
    });

    // Fetch turns via REST
    const { response, body } = await jsonRequest(server.baseUrl, `/api/sessions/${sessionId}/turns`);

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.session_id, sessionId);
    assert.equal(body.turns.length, 2);
    assert.equal(body.turns[0].turn_index, 0);
    assert.equal(body.turns[0].raw_transcript, 'What is Redis?');
    assert.equal(body.turns[1].turn_index, 1);
    assert.equal(body.turns[1].raw_transcript, 'What is Node.js?');
  } finally {
    await server.close();
  }
});

test('GET /api/sessions/:id/turns returns 404 for missing session', async () => {
  const server = await createTestServer();
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/api/sessions/missing-id/turns');

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.match(body.error, /not found/);
  } finally {
    await server.close();
  }
});
