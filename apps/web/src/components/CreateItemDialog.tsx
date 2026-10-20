import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useAuth } from '../state/auth.js';
import { useIntentKey } from '../api/idempotency.js';
import { useToast } from './ToastContext.js';

interface CreateItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTeamId?: string;
}

export const CreateItemDialog: React.FC<CreateItemDialogProps> = ({
  isOpen,
  onClose,
  defaultTeamId,
}) => {
  const { memberships } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { key: intentKey, reset: resetIntentKey } = useIntentKey();

  const [teamId, setTeamId] = useState(defaultTeamId || memberships[0]?.team_id || '');
  const [type, setType] = useState('customer_issue');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'p0' | 'p1' | 'p2' | 'p3'>('p2');
  const [tagsInput, setTagsInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);

  React.useEffect(() => {
    if (!teamId && memberships.length > 0) {
      setTeamId(defaultTeamId || memberships[0]?.team_id || '');
    }
  }, [memberships, defaultTeamId, teamId]);

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch('/items', {
        method: 'POST',
        body,
        idempotencyKey: intentKey,
      }),
    onSuccess: (createdItem: any) => {
      showToast('Item created successfully', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.itemsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRoot });
      resetIntentKey();
      onClose();
      navigate(`/items/${createdItem.id}`);
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to create item', 'error');
    },
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !teamId) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    createMutation.mutate({
      team_id: teamId,
      type,
      title: title.trim(),
      description: description.trim(),
      priority,
      tags,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      requires_approval: requiresApproval,
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '540px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Create Work Item</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
              Team *
            </label>
            <select
              className="input"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required
              style={{ width: '100%', fontSize: '13px' }}
            >
              {memberships.map((m) => (
                <option key={m.team_id} value={m.team_id}>
                  {m.team_name || m.team_id} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Type *
              </label>
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={{ width: '100%', fontSize: '13px' }}
              >
                <option value="customer_issue">Customer Issue</option>
                <option value="engineering_problem">Engineering Problem</option>
                <option value="payment_investigation">Payment Investigation</option>
                <option value="production_incident">Production Incident</option>
                <option value="compliance_request">Compliance Request</option>
                <option value="operational_task">Operational Task</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Priority *
              </label>
              <select
                className="input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                style={{ width: '100%', fontSize: '13px' }}
              >
                <option value="p0">P0 - Blocker</option>
                <option value="p1">P1 - High</option>
                <option value="p2">P2 - Normal</option>
                <option value="p3">P3 - Low</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
              Title *
            </label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the issue..."
              required
              style={{ width: '100%', fontSize: '13px' }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
              Description
            </label>
            <textarea
              className="input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description, steps to reproduce, impact..."
              style={{ width: '100%', resize: 'vertical', fontSize: '13px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Tags (comma separated)
              </label>
              <input
                type="text"
                className="input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="urgent, auth, billing"
                style={{ width: '100%', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Due Date
              </label>
              <input
                type="datetime-local"
                className="input"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                style={{ width: '100%', fontSize: '13px' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
              />
              <span>Requires Approval before Resolution</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMutation.isPending || !title.trim()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
