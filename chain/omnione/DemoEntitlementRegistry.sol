// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title DemoEntitlementRegistry — ONDO 해커톤 체험 혜택 사용 결과 기록 (OmniOne Chain)
/// @notice 이벤트 1종(DemoEntitlementRedeemed)만 기록한다.
///   eventKey          : 업무별 무작위 32바이트 (서버 내부에서 operation과 매핑, PII/DID/VC ID 아님)
///   payloadCommitment : sha256(비식별 manifest: {kind, schemaVersion, campaignRef, salt, suiDigestHash})
///   같은 eventKey는 두 번 기록되지 않는다. 허용된 signer만 기록한다.
///   혜택 원장은 서비스 DB이며, 이 계약은 그 결과의 중복 방지·검증 증거다.
contract DemoEntitlementRegistry {
    address public owner;
    mapping(address => bool) public recorders;

    struct Redemption { bytes32 payloadCommitment; uint64 recordedAt; address recorder; }
    mapping(bytes32 => Redemption) private redemptions;
    uint256 public total;

    event DemoEntitlementRedeemed(bytes32 indexed eventKey, bytes32 payloadCommitment, uint64 recordedAt, address recorder);
    event RecorderSet(address indexed recorder, bool allowed);

    modifier onlyOwner() { require(msg.sender == owner, "Registry: not owner"); _; }
    modifier onlyRecorder() { require(recorders[msg.sender], "Registry: not recorder"); _; }

    constructor() { owner = msg.sender; recorders[msg.sender] = true; emit RecorderSet(msg.sender, true); }

    function setRecorder(address recorder, bool allowed) external onlyOwner { recorders[recorder] = allowed; emit RecorderSet(recorder, allowed); }

    function recordRedemption(bytes32 eventKey, bytes32 payloadCommitment) external onlyRecorder {
        require(eventKey != bytes32(0) && payloadCommitment != bytes32(0), "Registry: empty");
        require(redemptions[eventKey].recordedAt == 0, "Registry: duplicate eventKey");
        redemptions[eventKey] = Redemption({ payloadCommitment: payloadCommitment, recordedAt: uint64(block.timestamp), recorder: msg.sender });
        total += 1;
        emit DemoEntitlementRedeemed(eventKey, payloadCommitment, uint64(block.timestamp), msg.sender);
    }

    function getRedemption(bytes32 eventKey) external view returns (bool exists, bytes32 payloadCommitment, uint64 recordedAt, address recorder) {
        Redemption memory r = redemptions[eventKey];
        return (r.recordedAt != 0, r.payloadCommitment, r.recordedAt, r.recorder);
    }
}
