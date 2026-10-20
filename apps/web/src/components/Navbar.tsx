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
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link to="/" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}>
            OpsFlow
          </Link>
          {user && (
            <nav style={{ display: 'flex', gap: '16px' }}>
              <Link to="/" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}>
                Dashboard
              </Link>
              <Link to="/items" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}>
                Items
              </Link>
              {primaryTeam && (
                <Link
                  to={`/teams/${primaryTeam.team_id}/members`}
                  style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '14px' }}
                >
                  Team Members
                </Link>
              )}
            </nav>
          )}
        </div>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {onOpenCreateItem && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onOpenCreateItem}
                style={{ padding: '6px 12px', fontSize: '13px' }}
              >
                + New Item
              </button>
            )}
            <NotificationBell />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ fontWeight: 600 }}>{user.display_name}</span>
              <span className="badge badge-outline" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                {user.org_role}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLogout}
              style={{ padding: '6px 10px', fontSize: '12px' }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
