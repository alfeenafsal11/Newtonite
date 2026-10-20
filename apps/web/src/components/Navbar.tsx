import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.js';
import { NotificationBell } from './NotificationBell.js';

interface NavbarProps {
  onOpenCreateItem?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCreateItem }) => {
  const { user, memberships, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const primaryTeam = memberships[0];

  return (
    <header className="navbar">
      <div className="navbar-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <Link
            to="/"
            style={{
              fontSize: '19px',
              fontWeight: 800,
              color: 'var(--color-primary)',
              textDecoration: 'none',
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            OpsFlow
          </Link>
          {user && (
            <nav style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <Link
                to="/"
                style={{
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: 500,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  transition: 'color 0.15s ease',
                }}
              >
                Dashboard
              </Link>
              <Link
                to="/items"
                style={{
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: 500,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  transition: 'color 0.15s ease',
                }}
              >
                Items
              </Link>
              {primaryTeam && (
                <Link
                  to={`/teams/${primaryTeam.team_id}/members`}
                  style={{
                    color: 'var(--color-text-muted)',
                    textDecoration: 'none',
                    fontSize: '14px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                  }}
                >
                  Team Members
                </Link>
              )}
            </nav>
          )}
        </div>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {onOpenCreateItem && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onOpenCreateItem}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>+</span> New Item
              </button>
            )}
            <NotificationBell />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                padding: '6px 12px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
              }}
            >
              <span style={{ fontWeight: 600 }}>{user.display_name}</span>
              <span
                className="badge badge-outline"
                style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {user.org_role}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLogout}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
