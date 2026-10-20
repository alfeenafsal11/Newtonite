import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth.js';
import { apiFetch, ApiError } from '../api/client.js';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await apiFetch<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      login(res.token, res.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Passw0rd!demo');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 6px 0' }}>
            OpsFlow
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: 0 }}>
            Operational Workflow Engine
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-sm)',
              color: '#f87171',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>
              Email Address
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@opsflow.test"
              required
              autoFocus
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ width: '100%' }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
            style={{ width: '100%', padding: '10px', fontWeight: 600 }}
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick-fill Demo Accounts (password: Passw0rd!demo or password123)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('admin@opsflow.test')}
            >
              admin (org_admin)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('support.lead@opsflow.test')}
            >
              support.lead
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('support.agent1@opsflow.test')}
            >
              support.agent1
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('support.agent2@opsflow.test')}
            >
              support.agent2
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('pay.approver@opsflow.test')}
            >
              pay.approver
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('eng.approver@opsflow.test')}
            >
              eng.approver
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('viewer@opsflow.test')}
            >
              viewer
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handleFillDemo('auditor@opsflow.test')}
            >
              auditor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
