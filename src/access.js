// Dashboard access control.
// --------------------------
// Deliberately not real authentication — there's no login, no password,
// no session. This is role-based gating for a 4-person internal pilot
// tool, appropriate to its threat model (behind whatever network/access
// boundary Impact4Good already runs on) and to "lightweight, one person
// can maintain this." A person is identified by an X-User-Id header the
// frontend sets from a plain "who are you" selector — nobody is verified
// cryptographically. Before this leaves pilot status, swap this for real
// auth (e.g. Supabase Auth once the Postgres migration in Architecture
// v0.1 happens, restricted to @impact4good.org) — flagged here, not
// glossed over.
//
// Roles: 'admin' (Shawn, Ira) — full access, including the dashboard's
// data-management actions (run the cohort engine, load sample data, take
// a metrics snapshot). 'viewer' (Audrey, Nick) — read the dashboard, but
// cannot trigger those actions from it. This does NOT touch their ability
// to work the Review Queue or Accounts tab — that's a different part of
// the app with its own, unrelated legitimate write access (marking
// touches sent/replied, recording a rebook) that has nothing to do with
// dashboard administration.

const store = require('./store');

function currentUser(req) {
  const id = req.get('X-User-Id');
  return id ? store.getUser(id) : null;
}

// Pure — no Express objects — so this is unit-testable without spinning up the server.
function canAccess(user, requiredRole) {
  if (!user) return false;
  if (requiredRole === 'admin') return user.role === 'admin';
  return true; // any recognized user can view
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Unrecognized or missing X-User-Id — sign in from the top bar.' });
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!canAccess(user, role)) {
      return res.status(403).json({ error: `This action requires the '${role}' role. Signed in as: ${user ? `${user.name} (${user.role})` : 'nobody recognized'}.` });
    }
    req.user = user;
    next();
  };
}

// Per-owner review queue scoping (Prompt 8 Item 1).
// ----------------------------------------------------
// Default: a viewer sees only their OWN queue — for Audrey/Nick, whose
// user id doubles as their owner id, that's automatic. An admin (Shawn,
// Ira) sees everyone's, for oversight, with no special flag required —
// that's a different concern from backup coverage between owners.
//
// Backup coverage — the "documented, explicit way for one to access the
// other's queue" — is a deliberate, named exception, not a side door:
// - ?asOwner=<targetOwnerId> must be passed explicitly; nothing defaults into it.
// - Only valid if the REQUESTER's own owner record names the target as who
//   they cover (store.js DEFAULT_OWNERS `backupFor` — read as "[this
//   owner] is backup for [backupFor]"; set by an admin on the Owners tab,
//   not self-declared by whoever's asking).
// - ?backupReason=<text> is required — a one-line reason, not just a flag.
// - Every use is logged (see server.js) so it's auditable after the fact,
//   not just gate-checked in the moment.
//
// Pure — no Express objects — so this is unit-testable directly.
function resolveQueueScope(user, query, store) {
  if (!user) return { error: 'Unrecognized or missing X-User-Id.' };

  if (user.role === 'admin') {
    // Admins can optionally filter by owner (plain convenience, not backup
    // coverage — they already have full visibility, so nothing to log).
    return { ownerId: query.ownerId || null, isBackup: false };
  }

  const requestedOwnerId = query.asOwner;
  if (!requestedOwnerId || requestedOwnerId === user.id) {
    return { ownerId: user.id, isBackup: false };
  }

  const requesterOwner = store.getOwner(user.id);
  if (!requesterOwner || requesterOwner.backupFor !== requestedOwnerId) {
    return { error: `${user.name} is not the designated backup for ${requestedOwnerId}'s queue. Backup coverage is set on the Owners tab, not self-declared.` };
  }
  if (!query.backupReason || !String(query.backupReason).trim()) {
    return { error: 'backupReason is required to view another owner\'s queue for backup coverage.' };
  }

  return { ownerId: requestedOwnerId, isBackup: true, reason: String(query.backupReason).trim() };
}

module.exports = { currentUser, canAccess, requireUser, requireRole, resolveQueueScope };
