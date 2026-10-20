import { z } from 'zod';

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ItemTypeSchema = z.enum([
  'customer_issue',
  'engineering_problem',
  'payment_investigation',
  'production_incident',
  'compliance_request',
  'operational_task',
]);

export const ItemPrioritySchema = z.enum(['p0', 'p1', 'p2', 'p3']);

export const ItemStatusSchema = z.enum([
  'open',
  'in_progress',
  'blocked',
  'pending_approval',
  'resolved',
  'closed',
]);

export const TeamRoleSchema = z.enum(['viewer', 'member', 'approver', 'admin']);

export const CreateItemBodySchema = z.object({
  team_id: z.string().uuid(),
  type: ItemTypeSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional().default(''),
  priority: ItemPrioritySchema.optional().default('p2'),
  tags: z.array(z.string().trim().min(1)).max(10).optional().default([]),
  due_at: z.string().datetime().optional().nullable(),
  requires_approval: z.boolean().optional(),
});

export const PatchItemBodySchema = z.object({
  expected_version: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20000).optional(),
  priority: ItemPrioritySchema.optional(),
  tags: z.array(z.string().trim().min(1)).max(10).optional(),
  due_at: z.string().datetime().optional().nullable(),
}).refine(
  (data) =>
    data.title !== undefined ||
    data.description !== undefined ||
    data.priority !== undefined ||
    data.tags !== undefined ||
    data.due_at !== undefined,
  {
    message: 'At least one field must be provided to patch an item',
  }
);

export const AssignBodySchema = z.object({
  expected_version: z.number().int().min(1),
  assignee_id: z.string().uuid(),
});

export const TransferBodySchema = z.object({
  expected_version: z.number().int().min(1),
  team_id: z.string().uuid(),
  reason: z.string().max(1000).optional(),
});

export const TransitionBodySchema = z.object({
  expected_version: z.number().int().min(1),
  name: z.enum(['block', 'unblock', 'resolve', 'reopen', 'close', 'cancel']),
  reason: z.string().max(1000).optional(),
  resolution_note: z.string().max(1000).optional(),
});

export const CommentBodySchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export const ApprovalRequestSchema = z.object({
  expected_version: z.number().int().min(1),
});

export const ApprovalDecisionSchema = z.object({
  expected_version: z.number().int().min(1),
  note: z.string().max(1000).optional(),
});

export const MemberRoleBodySchema = z.object({
  role: TeamRoleSchema,
});

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const ListItemsQuerySchema = z.object({
  team_id: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  status: z.union([ItemStatusSchema, z.array(ItemStatusSchema)]).optional(),
  priority: z.union([ItemPrioritySchema, z.array(ItemPrioritySchema)]).optional(),
  type: z.union([ItemTypeSchema, z.array(ItemTypeSchema)]).optional(),
  assignee: z.string().optional(), // 'me' | 'unassigned' | uuid
  reporter: z.string().optional(), // 'me' | uuid
  tag: z.string().optional(),
  q: z.string().optional(),
  due: z.enum(['overdue', 'today', 'week']).optional(),
  stale: z.enum(['true', 'false']).optional(),
  awaiting_my_approval: z.enum(['true', 'false']).optional(),
  include_closed: z.enum(['true', 'false']).optional().default('false'),
  sort: z.enum(['activity_desc', 'priority_due', 'created_desc']).optional().default('activity_desc'),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
