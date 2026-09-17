#[test_only]
module ondo_entitlement::entitlement_tests;

use sui::clock;
use sui::test_scenario as ts;
use ondo_entitlement::entitlement::{Self, AdminCap, Campaign, Entitlement, Grant, ExecutionRecord};

const ADMIN: address = @0xA1;
const ISSUER: address = @0x15;
const AGENT: address = @0xA6;
const USER: address = @0x05;
const OTHER: address = @0x07;

fun commitment(b: u8): vector<u8> { let mut v = vector[]; let mut i = 0u8; while (i < 32) { v.push_back(b); i = i + 1; }; v }

fun setup(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    entitlement::init_for_testing(s.ctx());
    s.next_tx(ADMIN);
    {
        let cap = s.take_from_sender<AdminCap>();
        entitlement::create_campaign(&cap, b"hk-identity-perk-v1", ISSUER, AGENT, 1, s.ctx());
        s.return_to_sender(cap);
    };
    s
}

fun issue_to_user(s: &mut ts::Scenario, clk: &clock::Clock) {
    s.next_tx(ISSUER);
    let mut c = s.take_shared<Campaign>();
    entitlement::issue(&mut c, commitment(1), USER, clk.timestamp_ms() + 600_000, clk, s.ctx());
    ts::return_shared(c);
}

#[test]
fun happy_path_issue_delegate_consume() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);

    // user PTB: delegate + attest_consent
    s.next_tx(USER);
    {
        let mut c = s.take_shared<Campaign>();
        let e = s.take_from_sender<Entitlement>();
        let gid = entitlement::delegate(&mut c, e, USER, commitment(2), clk.timestamp_ms() + 300_000, &clk, s.ctx());
        entitlement::attest_consent(&c, gid, commitment(3), s.ctx());
        ts::return_shared(c);
    };

    // agent PTB: consume + attest_execution
    s.next_tx(AGENT);
    {
        let mut c = s.take_shared<Campaign>();
        let mut g = s.take_shared<Grant>();
        assert!(entitlement::grant_uses(&g) == 0);
        let rid = entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        entitlement::attest_execution(&c, rid, commitment(5), s.ctx());
        assert!(entitlement::grant_uses(&g) == 1);
        let (issued, delegated, consumed) = entitlement::campaign_counts(&c);
        assert!(issued == 1 && delegated == 1 && consumed == 1);
        ts::return_shared(g);
        ts::return_shared(c);
    };

    // record landed with recipient (USER), soulbound
    s.next_tx(USER);
    {
        let rec = s.take_from_sender<ExecutionRecord>();
        s.return_to_sender(rec);
    };
    clk.destroy_for_testing();
    s.end();
}

#[test, expected_failure(abort_code = entitlement::ENotIssuer)]
fun public_mint_is_rejected() {
    let mut s = setup();
    let clk = clock::create_for_testing(s.ctx());
    s.next_tx(OTHER);
    let mut c = s.take_shared<Campaign>();
    entitlement::issue(&mut c, commitment(1), OTHER, 600_000, &clk, s.ctx());
    abort 0
}

#[test, expected_failure(abort_code = entitlement::EConsumed)]
fun second_consume_is_rejected() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);
    s.next_tx(USER);
    {
        let mut c = s.take_shared<Campaign>();
        let e = s.take_from_sender<Entitlement>();
        entitlement::delegate(&mut c, e, USER, commitment(2), clk.timestamp_ms() + 300_000, &clk, s.ctx());
        ts::return_shared(c);
    };
    s.next_tx(AGENT);
    {
        let mut c = s.take_shared<Campaign>();
        let mut g = s.take_shared<Grant>();
        entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        abort 0
    }
}

#[test, expected_failure(abort_code = entitlement::ENotAgent)]
fun wrong_agent_is_rejected() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);
    s.next_tx(USER);
    {
        let mut c = s.take_shared<Campaign>();
        let e = s.take_from_sender<Entitlement>();
        entitlement::delegate(&mut c, e, USER, commitment(2), clk.timestamp_ms() + 300_000, &clk, s.ctx());
        ts::return_shared(c);
    };
    s.next_tx(OTHER);
    {
        let mut c = s.take_shared<Campaign>();
        let mut g = s.take_shared<Grant>();
        entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        abort 0
    }
}

#[test, expected_failure(abort_code = entitlement::EExpired)]
fun expired_grant_is_rejected() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);
    s.next_tx(USER);
    {
        let mut c = s.take_shared<Campaign>();
        let e = s.take_from_sender<Entitlement>();
        entitlement::delegate(&mut c, e, USER, commitment(2), clk.timestamp_ms() + 1_000, &clk, s.ctx());
        ts::return_shared(c);
    };
    clk.set_for_testing(1_002_000);
    s.next_tx(AGENT);
    {
        let mut c = s.take_shared<Campaign>();
        let mut g = s.take_shared<Grant>();
        entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        abort 0
    }
}

#[test, expected_failure(abort_code = entitlement::ERevoked)]
fun revoked_grant_is_rejected() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);
    s.next_tx(USER);
    {
        let mut c = s.take_shared<Campaign>();
        let e = s.take_from_sender<Entitlement>();
        entitlement::delegate(&mut c, e, USER, commitment(2), clk.timestamp_ms() + 300_000, &clk, s.ctx());
        ts::return_shared(c);
    };
    s.next_tx(USER);
    {
        let mut g = s.take_shared<Grant>();
        entitlement::revoke(&mut g, s.ctx());
        ts::return_shared(g);
    };
    s.next_tx(AGENT);
    {
        let mut c = s.take_shared<Campaign>();
        let mut g = s.take_shared<Grant>();
        entitlement::consume(&mut c, &mut g, commitment(4), &clk, s.ctx());
        abort 0
    }
}

#[test, expected_failure(abort_code = entitlement::ENotOwner)]
fun delegate_by_non_holder_is_rejected() {
    let mut s = setup();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(1_000_000);
    issue_to_user(&mut s, &clk);
    s.next_tx(USER);
    let e = s.take_from_sender<Entitlement>();
    s.next_tx(OTHER);
    let mut c = s.take_shared<Campaign>();
    entitlement::delegate(&mut c, e, OTHER, commitment(2), clk.timestamp_ms() + 300_000, &clk, s.ctx());
    abort 0
}
