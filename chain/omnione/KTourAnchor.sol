// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title KTourAnchor — KTourID 검증 결과 앵커 (OmniOne Chain)
/// @notice 개인정보는 절대 기록하지 않는다. 기록되는 것은
///         (1) 검증 결과 해시(attestationHash = keccak256(is_adult || vc_hash || expires_at || sui_address))
///         (2) 같은 결과가 발급된 Sui 트랜잭션 digest
///         (3) 블록 타임스탬프
///         뿐이다. 심사 Q&A용 한 줄: "행안부 신뢰 체계 쪽(OmniOne Chain)에는 감사 가능한 앵커를,
///         글로벌 사용자 쪽(Sui)에는 실제 자산을 둔다."
contract KTourAnchor {
    address public owner;

    struct Anchor {
        bytes32 suiTxDigest; // Sui Testnet에서 AgeAttestation/Stamp가 발급된 tx digest
        uint64 anchoredAt;   // block.timestamp
        uint8 kind;          // 1 = AgeAttestation, 2 = Stamp, 3 = CurationSnapshot
    }

    mapping(bytes32 => Anchor) private anchors;
    uint256 public totalAnchored;

    event Anchored(bytes32 indexed attestationHash, bytes32 suiTxDigest, uint8 kind, uint64 anchoredAt);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "KTourAnchor: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnerChanged(address(0), msg.sender);
    }

    /// @notice 검증 결과 해시를 앵커링한다. 같은 해시는 한 번만 기록된다.
    function anchor(bytes32 attestationHash, bytes32 suiTxDigest, uint8 kind) external onlyOwner {
        require(attestationHash != bytes32(0), "KTourAnchor: empty hash");
        require(anchors[attestationHash].anchoredAt == 0, "KTourAnchor: already anchored");
        anchors[attestationHash] = Anchor({
            suiTxDigest: suiTxDigest,
            anchoredAt: uint64(block.timestamp),
            kind: kind
        });
        totalAnchored += 1;
        emit Anchored(attestationHash, suiTxDigest, kind, uint64(block.timestamp));
    }

    /// @notice 앵커 존재 여부와 내용을 조회한다 (eth_call).
    function verify(bytes32 attestationHash)
        external
        view
        returns (bool exists, bytes32 suiTxDigest, uint64 anchoredAt, uint8 kind)
    {
        Anchor memory a = anchors[attestationHash];
        return (a.anchoredAt != 0, a.suiTxDigest, a.anchoredAt, a.kind);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "KTourAnchor: zero address");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
