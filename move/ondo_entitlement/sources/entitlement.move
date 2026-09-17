/// ONDO · K-Tour ID — bounded, single-use agent execution rights for one
/// hackathon "experience perk" campaign.
///
/// Roles
/// - `issuer`  : ONDO server signer. Mints an `Entitlement` to a user address
///               only after the server verified CX identity + OpenDID VP.
///               No public mint exists.
/// - `owner`   : the user (zkLogin or demo signer). Turns the Entitlement into
///               a shared `Grant` that names ONE agent, ONE recipient, ONE
///               action commitment, an expiry and max 1 use (delegate PTB).
/// - `agent`   : ONDO agent worker signer. Consumes the Grant exactly once and
///               leaves an `ExecutionRecord` (consume PTB). It cannot widen the
///               scope: recipient/commitment/expiry come from the Grant.
///
/// Nothing here carries PII: intent_ref / commitments are random or hashed
/// references that the ONDO service maps internally. Move enforces issuer,
/// ownership, allowed agent, expiry, revocation and use count; the service
/// still decides fulfilment separately (Sui consume != benefit used).
module ondo_entitlement::entitlement;

use sui::clock::Clock;
use sui::event;

// ── errors ────────────────────────────────────────────────────────────
const ENotIssuer: u64 = 1;
const ENotAgent: u64 = 2;
const ENotOwner: u64 = 3;
const EExpired: u64 = 4;
const ERevoked: u64 = 5;
const EConsumed: u64 = 6;
const ECampaignMismatch: u64 = 7;
const EBadExpiry: u64 = 8;
const ECampaignClosed: u64 = 9;
const EBadCommitment: u64 = 10;

const MAX_USES: u8 = 1;

// ── objects ───────────────────────────────────────────────────────────
/// Package admin capability (created once at publish, sent to publisher).
public struct AdminCap has key, store { id: UID }

/// One campaign = one venue perk. Shared.
public struct Campaign has key {
    id: UID,
    campaign_ref: vector<u8>,
    issuer: address,
    agent: address,
    policy_version: u64,
    active: bool,
    issued: u64,
    delegated: u64,
    consumed: u64,
}

/// Issued by the campaign issuer to a verified user. `key` only → cannot be
/// transferred by the holder; it can only be spent in `delegate`.
public struct Entitlement has key {
    id: UID,
    campaign: ID,
    intent_ref: vector<u8>,
    holder: address,
    expires_at_ms: u64,
}

/// The user's bounded delegation. Shared so the named agent can consume it.
public struct Grant has key {
    id: UID,
    campaign: ID,
    intent_ref: vector<u8>,
    owner: address,
    agent: address,
    recipient: address,
    action_commitment: vector<u8>,
    policy_version: u64,
    expires_at_ms: u64,
    max_uses: u8,
    uses: u8,
    revoked: bool,
}

/// Proof that the agent executed within the grant. `key` only → soulbound to
/// the recipient.
public struct ExecutionRecord has key {
    id: UID,
    campaign: ID,
    grant: ID,
    intent_ref: vector<u8>,
    action_commitment: vector<u8>,
    decision_commitment: vector<u8>,
    executed_at_ms: u64,
    agent: address,
}

// ── events ────────────────────────────────────────────────────────────
public struct CampaignCreated has copy, drop { campaign: ID, campaign_ref: vector<u8>, issuer: address, agent: address, policy_version: u64 }
public struct EntitlementIssued has copy, drop { campaign: ID, entitlement: ID, intent_ref: vector<u8>, holder: address, expires_at_ms: u64 }
public struct GrantCreated has copy, drop { campaign: ID, grant: ID, intent_ref: vector<u8>, owner: address, agent: address, recipient: address, action_commitment: vector<u8>, expires_at_ms: u64 }
public struct ConsentAttested has copy, drop { campaign: ID, grant: ID, owner: address, consent_commitment: vector<u8> }
public struct GrantConsumed has copy, drop { campaign: ID, grant: ID, record: ID, intent_ref: vector<u8>, decision_commitment: vector<u8>, agent: address, recipient: address, executed_at_ms: u64 }
public struct ExecutionAttested has copy, drop { campaign: ID, record: ID, agent: address, manifest_commitment: vector<u8> }
public struct GrantRevoked has copy, drop { campaign: ID, grant: ID, intent_ref: vector<u8>, owner: address }

// ── init / admin ──────────────────────────────────────────────────────
fun init(ctx: &mut TxContext) {
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

public fun create_campaign(
    _: &AdminCap,
    campaign_ref: vector<u8>,
    issuer: address,
    agent: address,
    policy_version: u64,
    ctx: &mut TxContext,
) {
    let campaign = Campaign {
        id: object::new(ctx), campaign_ref, issuer, agent, policy_version,
        active: true, issued: 0, delegated: 0, consumed: 0,
    };
    event::emit(CampaignCreated { campaign: object::id(&campaign), campaign_ref: campaign.campaign_ref, issuer, agent, policy_version });
    transfer::share_object(campaign);
}

public fun set_active(_: &AdminCap, campaign: &mut Campaign, active: bool) { campaign.active = active; }
public fun set_agent(_: &AdminCap, campaign: &mut Campaign, agent: address) { campaign.agent = agent; }
public fun set_issuer(_: &AdminCap, campaign: &mut Campaign, issuer: address) { campaign.issuer = issuer; }

// ── issuer: mint entitlement (no public mint) ─────────────────────────
public fun issue(
    campaign: &mut Campaign,
    intent_ref: vector<u8>,
    holder: address,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(campaign.active, ECampaignClosed);
    assert!(ctx.sender() == campaign.issuer, ENotIssuer);
    assert!(intent_ref.length() == 32, EBadCommitment);
    assert!(expires_at_ms > clock.timestamp_ms(), EBadExpiry);
    let entitlement = Entitlement { id: object::new(ctx), campaign: object::id(campaign), intent_ref, holder, expires_at_ms };
    campaign.issued = campaign.issued + 1;
    event::emit(EntitlementIssued { campaign: object::id(campaign), entitlement: object::id(&entitlement), intent_ref: entitlement.intent_ref, holder, expires_at_ms });
    transfer::transfer(entitlement, holder);
}

// ── owner: delegate (user PTB, command 1) ─────────────────────────────
/// Spends the Entitlement and creates a shared Grant bounded to the campaign
/// agent, one recipient, one action commitment and an expiry no later than the
/// entitlement's own. Returns the Grant id so the same PTB can attest consent.
public fun delegate(
    campaign: &mut Campaign,
    entitlement: Entitlement,
    recipient: address,
    action_commitment: vector<u8>,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(campaign.active, ECampaignClosed);
    assert!(entitlement.campaign == object::id(campaign), ECampaignMismatch);
    assert!(entitlement.holder == ctx.sender(), ENotOwner);
    assert!(action_commitment.length() == 32, EBadCommitment);
    let now = clock.timestamp_ms();
    assert!(entitlement.expires_at_ms > now, EExpired);
    assert!(expires_at_ms > now && expires_at_ms <= entitlement.expires_at_ms, EBadExpiry);

    let Entitlement { id, campaign: campaign_id, intent_ref, holder: _, expires_at_ms: _ } = entitlement;
    id.delete();

    let grant = Grant {
        id: object::new(ctx), campaign: campaign_id, intent_ref,
        owner: ctx.sender(), agent: campaign.agent, recipient, action_commitment,
        policy_version: campaign.policy_version, expires_at_ms,
        max_uses: MAX_USES, uses: 0, revoked: false,
    };
    let grant_id = object::id(&grant);
    campaign.delegated = campaign.delegated + 1;
    event::emit(GrantCreated { campaign: campaign_id, grant: grant_id, intent_ref: grant.intent_ref, owner: grant.owner, agent: grant.agent, recipient, action_commitment: grant.action_commitment, expires_at_ms });
    transfer::share_object(grant);
    grant_id
}

/// User PTB, command 2: binds the consent digest to the grant id returned by
/// `delegate` in the same transaction (data flow between PTB commands).
public fun attest_consent(campaign: &Campaign, grant: ID, consent_commitment: vector<u8>, ctx: &TxContext) {
    assert!(consent_commitment.length() == 32, EBadCommitment);
    event::emit(ConsentAttested { campaign: object::id(campaign), grant, owner: ctx.sender(), consent_commitment });
}

// ── owner: revoke ─────────────────────────────────────────────────────
public fun revoke(grant: &mut Grant, ctx: &TxContext) {
    assert!(ctx.sender() == grant.owner, ENotOwner);
    assert!(grant.uses == 0, EConsumed);
    grant.revoked = true;
    event::emit(GrantRevoked { campaign: grant.campaign, grant: object::id(grant), intent_ref: grant.intent_ref, owner: grant.owner });
}

// ── agent: consume (agent PTB, command 1) ─────────────────────────────
/// Consumes the grant exactly once and leaves a soulbound ExecutionRecord with
/// the recipient. Returns the record id for `attest_execution`.
public fun consume(
    campaign: &mut Campaign,
    grant: &mut Grant,
    decision_commitment: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(campaign.active, ECampaignClosed);
    assert!(grant.campaign == object::id(campaign), ECampaignMismatch);
    assert!(ctx.sender() == grant.agent && grant.agent == campaign.agent, ENotAgent);
    assert!(!grant.revoked, ERevoked);
    assert!(grant.uses < grant.max_uses, EConsumed);
    assert!(decision_commitment.length() == 32, EBadCommitment);
    let now = clock.timestamp_ms();
    assert!(grant.expires_at_ms > now, EExpired);

    grant.uses = grant.uses + 1;
    let record = ExecutionRecord {
        id: object::new(ctx), campaign: grant.campaign, grant: object::id(grant),
        intent_ref: grant.intent_ref, action_commitment: grant.action_commitment,
        decision_commitment, executed_at_ms: now, agent: ctx.sender(),
    };
    let record_id = object::id(&record);
    campaign.consumed = campaign.consumed + 1;
    event::emit(GrantConsumed { campaign: grant.campaign, grant: object::id(grant), record: record_id, intent_ref: grant.intent_ref, decision_commitment: record.decision_commitment, agent: ctx.sender(), recipient: grant.recipient, executed_at_ms: now });
    transfer::transfer(record, grant.recipient);
    record_id
}

/// Agent PTB, command 2: links the (off-chain, de-identified) execution
/// manifest commitment to the record created by `consume` in the same PTB.
public fun attest_execution(campaign: &Campaign, record: ID, manifest_commitment: vector<u8>, ctx: &TxContext) {
    assert!(manifest_commitment.length() == 32, EBadCommitment);
    assert!(ctx.sender() == campaign.agent, ENotAgent);
    event::emit(ExecutionAttested { campaign: object::id(campaign), record, agent: ctx.sender(), manifest_commitment });
}

// ── views ─────────────────────────────────────────────────────────────
public fun grant_uses(grant: &Grant): u8 { grant.uses }
public fun grant_revoked(grant: &Grant): bool { grant.revoked }
public fun grant_agent(grant: &Grant): address { grant.agent }
public fun grant_owner(grant: &Grant): address { grant.owner }
public fun grant_recipient(grant: &Grant): address { grant.recipient }
public fun grant_expires_at_ms(grant: &Grant): u64 { grant.expires_at_ms }
public fun grant_action_commitment(grant: &Grant): vector<u8> { grant.action_commitment }
public fun campaign_counts(campaign: &Campaign): (u64, u64, u64) { (campaign.issued, campaign.delegated, campaign.consumed) }
public fun campaign_agent(campaign: &Campaign): address { campaign.agent }
public fun campaign_issuer(campaign: &Campaign): address { campaign.issuer }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
