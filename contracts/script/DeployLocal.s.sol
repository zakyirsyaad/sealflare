// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {CoreStub} from "../src/stubs/CoreStub.sol";
import {CourtStub} from "../src/stubs/CourtStub.sol";
import {MockAgentID} from "../src/stubs/MockAgentID.sol";
import {VaultStub} from "../src/stubs/VaultStub.sol";

/// Deploys the stubs to a local Anvil node and writes their addresses to
/// shared/abi/addresses.local.json. Refuses to run on any other chain.
contract DeployLocal is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    string internal constant OUTPUT = "../shared/abi/addresses.local.json";

    error NotLocalChain(uint256 chainId);

    /// Same order as the real deployment: Core, Vault(core), Court(core, vault), setModules.
    function deploy() public returns (MockAgentID agentId, CoreStub core, CourtStub court, VaultStub vault) {
        agentId = new MockAgentID();
        core = new CoreStub(address(agentId));
        vault = new VaultStub(address(core), msg.sender);
        court = new CourtStub(address(core), address(vault));
        core.setModules(address(court), address(vault));
    }

    function run() external {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        vm.startBroadcast();
        (MockAgentID agentId, CoreStub core, CourtStub court, VaultStub vault) = deploy();
        vm.stopBroadcast();

        string memory key = "addresses";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "agentId", address(agentId));
        vm.serializeAddress(key, "core", address(core));
        vm.serializeAddress(key, "court", address(court));
        vm.writeJson(vm.serializeAddress(key, "vault", address(vault)), OUTPUT);
    }
}
