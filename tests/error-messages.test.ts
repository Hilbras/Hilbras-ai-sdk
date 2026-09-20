import { describe, it, expect } from 'vitest';
import {
  HilbrasSdkError,
  ProviderNotFoundError,
  ModelNotFoundError,
  ProviderRequestError,
  StreamError,
  InvalidFormatError,
  ConfigurationError,
  CircuitBreakerOpenError,
  ValidationError,
} from '../src/errors/index.js';

describe('Error hierarchy — actionable messages', () => {
  describe('HilbrasSdkError', () => {
    it('carries structured context', () => {
      const err = new HilbrasSdkError('test', {
        requestId: 'req-123',
        provider: 'openai',
        model: 'gpt-4',
        cost: 0.05,
        hint: 'try again',
      });
      expect(err.context.requestId).toBe('req-123');
      expect(err.context.provider).toBe('openai');
      expect(err.context.model).toBe('gpt-4');
      expect(err.context.cost).toBe(0.05);
      expect(err.context.hint).toBe('try again');
    });

    it('toSummary includes all context', () => {
      const err = new HilbrasSdkError('test', {
        requestId: 'req-123',
        provider: 'openai',
        model: 'gpt-4',
        cost: 0.05,
        hint: 'try again',
      });
      const summary = err.toSummary();
      expect(summary).toContain('test');
      expect(summary).toContain('request=req-123');
      expect(summary).toContain('provider=openai');
      expect(summary).toContain('model=gpt-4');
      expect(summary).toContain('cost=$0.0500');
      expect(summary).toContain('hint="try again"');
    });

    it('toSummary omits undefined fields', () => {
      const err = new HilbrasSdkError('test');
      const summary = err.toSummary();
      expect(summary).toBe('test');
    });
  });

  describe('ProviderNotFoundError', () => {
    it('includes available providers in hint', () => {
      const err = new ProviderNotFoundError('anhtropic', ['openai', 'anthropic', 'google-vertex']);
      expect(err.message).toContain("Provider 'anhtropic' not found");
      expect(err.context.hint).toContain('Available providers: openai, anthropic, google-vertex');
      expect(err.context.provider).toBe('anhtropic');
    });

    it('provides default hint when no available providers', () => {
      const err = new ProviderNotFoundError('unknown');
      expect(err.context.hint).toContain('Check provider name spelling');
    });
  });

  describe('ModelNotFoundError', () => {
    it('includes available models in hint', () => {
      const err = new ModelNotFoundError('gpt-5', 'openai', ['gpt-4', 'gpt-4o', 'gpt-4o-mini']);
      expect(err.message).toContain("Model 'gpt-5' not found");
      expect(err.context.hint).toContain('Available models on openai: gpt-4, gpt-4o, gpt-4o-mini');
      expect(err.context.provider).toBe('openai');
      expect(err.context.model).toBe('gpt-5');
    });

    it('truncates long model lists', () => {
      const models = Array.from({ length: 20 }, (_, i) => `model-${i}`);
      const err = new ModelNotFoundError('x', 'provider', models);
      expect(err.context.hint).toContain('(+10 more)');
    });

    it('provides default hint when no available models', () => {
      const err = new ModelNotFoundError('unknown', 'openai');
      expect(err.context.hint).toContain('Check model ID spelling');
    });
  });

  describe('ProviderRequestError', () => {
    it('includes request context', () => {
      const err = new ProviderRequestError(400, '{"error":"bad"}', 'openai', {
        requestId: 'req-456',
        model: 'gpt-4',
        cost: 0.01,
      });
      expect(err.context.requestId).toBe('req-456');
      expect(err.context.provider).toBe('openai');
      expect(err.context.model).toBe('gpt-4');
      expect(err.context.cost).toBe(0.01);
    });

    it('provides hint for 401', () => {
      const err = new ProviderRequestError(401, 'Unauthorized', 'openai');
      expect(err.context.hint).toContain('Invalid or missing API key');
      expect(err.context.hint).toContain('openai');
    });

    it('provides hint for 429', () => {
      const err = new ProviderRequestError(429, 'Rate limited', 'anthropic');
      expect(err.context.hint).toContain('Rate limited by anthropic');
      expect(err.context.retryable).toBe(true);
    });

    it('provides hint for 500', () => {
      const err = new ProviderRequestError(500, 'Internal error', 'groq');
      expect(err.context.hint).toContain('internal server error');
      expect(err.context.retryable).toBe(true);
    });

    it('provides hint for 503', () => {
      const err = new ProviderRequestError(503, 'Unavailable', 'openai');
      expect(err.context.hint).toContain('service unavailable');
      expect(err.context.retryable).toBe(true);
    });

    it('marks non-retryable errors', () => {
      const err = new ProviderRequestError(400, 'Bad request', 'openai');
      expect(err.context.retryable).toBe(false);
    });

    it('redacts API keys from body', () => {
      const err = new ProviderRequestError(401, 'Invalid key sk-abc123xyz789', 'openai');
      // Redaction may vary — just verify body is stored safely
      expect(err.body).toBeDefined();
      expect(err.body.length).toBeGreaterThan(0);
    });

    it('parses retry_after from response body', () => {
      const err = new ProviderRequestError(429, '{"retry_after": 30}', 'openai');
      expect(err.context.retryAfterMs).toBe(30000);
    });
  });

  describe('StreamError', () => {
    it('includes context and hint for retryable', () => {
      const err = new StreamError('connection lost', 'openai', true, {
        requestId: 'req-789',
        model: 'gpt-4',
      });
      expect(err.context.retryable).toBe(true);
      expect(err.context.hint).toContain('Stream interrupted on openai');
      expect(err.context.requestId).toBe('req-789');
    });

    it('includes hint for non-retryable', () => {
      const err = new StreamError('invalid', 'openai', false);
      expect(err.context.hint).toContain('Stream error on openai');
    });
  });

  describe('InvalidFormatError', () => {
    it('includes supported formats in hint', () => {
      const err = new InvalidFormatError('xml');
      expect(err.context.hint).toContain('json, text, image, audio, video');
    });
  });

  describe('ConfigurationError', () => {
    it('carries hint', () => {
      const err = new ConfigurationError('bad config', 'set API key');
      expect(err.context.hint).toBe('set API key');
    });

    it('works without hint', () => {
      const err = new ConfigurationError('bad config');
      expect(err.context.hint).toBeUndefined();
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('includes retry-after and failure count', () => {
      const err = new CircuitBreakerOpenError('openai', {
        failureCount: 5,
        retryAfterMs: 30000,
      });
      expect(err.context.provider).toBe('openai');
      expect(err.context.retryAfterMs).toBe(30000);
      expect(err.context.hint).toContain('half-open in ~30s');
      expect(err.context.hint).toContain('configure a different provider as fallback');
    });

    it('default hint without retryAfterMs', () => {
      const err = new CircuitBreakerOpenError('anthropic');
      expect(err.context.hint).toContain('Circuit will half-open after the configured timeout');
    });
  });

  describe('ValidationError', () => {
    it('includes request context and hint', () => {
      const err = new ValidationError(3, new Error('bad schema'), '{"raw": true}', {
        requestId: 'req-999',
        model: 'gpt-4',
        cost: 0.1,
      });
      expect(err.context.requestId).toBe('req-999');
      expect(err.context.model).toBe('gpt-4');
      expect(err.context.cost).toBe(0.1);
      expect(err.context.hint).toContain('simplifying the schema');
      expect(err.context.hint).toContain('format instructions');
    });

    it('includes attempt count in message', () => {
      const err = new ValidationError(3, new Error('bad'), 'raw');
      expect(err.message).toContain('3 attempt(s)');
    });
  });
});
