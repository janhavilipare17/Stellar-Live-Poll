#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    OptionA,
    OptionB,
}

#[contract]
pub struct PollContract;

#[contractimpl]
impl PollContract {
    pub fn vote_a(env: Env) {
        let current: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OptionA)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::OptionA, &(current + 1));
    }

    pub fn vote_b(env: Env) {
        let current: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OptionB)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::OptionB, &(current + 1));
    }

    pub fn get_results(env: Env) -> (u32, u32) {
        let a: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OptionA)
            .unwrap_or(0);
        let b: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::OptionB)
            .unwrap_or(0);
        (a, b)
    }
}