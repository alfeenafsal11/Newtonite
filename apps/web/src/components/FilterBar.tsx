import React, { useState, useEffect } from 'react';
import { ItemFilters } from '../state/filters.js';
import { useAuth } from '../state/auth.js';

interface FilterBarProps {
  filters: ItemFilters;
  onChange: (filters: ItemFilters) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onChange }) => {
  const { memberships } = useAuth();
  const [searchInput, setSearchInput] = useState(filters.q || '');

  // 300ms debounce for search box
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.q || '') !== searchInput) {
        onChange({ ...filters, q: searchInput ? searchInput : undefined });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Keep searchInput in sync if filters.q changes externally
  useEffect(() => {
    setSearchInput(filters.q || '');
  }, [filters.q]);

  const handleFieldChange = (key: keyof ItemFilters, value: any) => {
    onChange({
      ...filters,
      [key]: value === '' || value === undefined ? undefined : value,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        padding: '12px 16px',
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        alignItems: 'center',
        marginBottom: '16px',
      }}
    >
      {/* Search Input */}
      <div style={{ flex: '1 1 200px' }}>
        <input
          type="search"
          className="input"
          placeholder="Search title, desc, OPS-123..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: '100%', fontSize: '13px' }}
        />
      </div>

      {/* Team Filter */}
      {memberships.length > 0 && (
        <div>
          <select
            className="input"
            value={filters.team_id || ''}
            onChange={(e) => handleFieldChange('team_id', e.target.value)}
            style={{ fontSize: '13px', padding: '6px 10px' }}
          >
            <option value="">All My Teams</option>
            {memberships.map((m) => (
              <option key={m.team_id} value={m.team_id}>
                {m.team_name || m.team_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Status Filter */}
      <div>
        <select
          className="input"
          value={filters.status?.[0] || ''}
          onChange={(e) =>
            handleFieldChange('status', e.target.value ? [e.target.value] : undefined)
          }
          style={{ fontSize: '13px', padding: '6px 10px' }}
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* Priority Filter */}
      <div>
        <select
          className="input"
          value={filters.priority?.[0] || ''}
          onChange={(e) =>
            handleFieldChange('priority', e.target.value ? [e.target.value] : undefined)
          }
          style={{ fontSize: '13px', padding: '6px 10px' }}
        >
          <option value="">All Priorities</option>
          <option value="p0">P0 - Blocker</option>
          <option value="p1">P1 - High</option>
          <option value="p2">P2 - Normal</option>
          <option value="p3">P3 - Low</option>
        </select>
      </div>

      {/* Assignee Filter */}
      <div>
        <select
          className="input"
          value={filters.assignee || ''}
          onChange={(e) => handleFieldChange('assignee', e.target.value)}
          style={{ fontSize: '13px', padding: '6px 10px' }}
        >
          <option value="">All Assignees</option>
          <option value="me">Assigned to Me</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {/* Due Filter */}
      <div>
        <select
          className="input"
          value={filters.due || ''}
          onChange={(e) => handleFieldChange('due', e.target.value)}
          style={{ fontSize: '13px', padding: '6px 10px' }}
        >
          <option value="">Due: Any</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due Today</option>
          <option value="week">Due This Week</option>
        </select>
      </div>

      {/* Stale Checkbox */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!filters.stale}
          onChange={(e) => handleFieldChange('stale', e.target.checked ? true : undefined)}
        />
        <span>Stale Only</span>
      </label>

      {/* Sort Select */}
      <div>
        <select
          className="input"
          value={filters.sort || 'activity_desc'}
          onChange={(e) => handleFieldChange('sort', e.target.value)}
          style={{ fontSize: '13px', padding: '6px 10px' }}
        >
          <option value="activity_desc">Sort: Recent Activity</option>
          <option value="priority_due">Sort: Priority & Due</option>
          <option value="created_desc">Sort: Created Date</option>
        </select>
      </div>
    </div>
  );
};
