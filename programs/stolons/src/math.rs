use crate::errors::StolonsError;
use anchor_lang::prelude::*;

pub fn root_mass_transfer(parent_mass: u128, burn_atoms: u64, supply_before_burn: u64) -> Result<u128> {
    require!(supply_before_burn > 0, StolonsError::ArithmeticError);
    require!(burn_atoms > 0 && burn_atoms < supply_before_burn, StolonsError::InsufficientReproductionReserve);
    let numerator = parent_mass.checked_mul(burn_atoms as u128).ok_or(StolonsError::ArithmeticError)?;
    let moved = numerator.checked_div(supply_before_burn as u128).ok_or(StolonsError::ArithmeticError)?;
    require!(moved > 0, StolonsError::ZeroMassTransfer);
    Ok(moved)
}

pub fn validate_family_move(parent_mass: u128, child_mass: u128, transferred: u128) -> Result<(u128, u128)> {
    let new_parent = parent_mass.checked_sub(transferred).ok_or(StolonsError::ArithmeticError)?;
    let new_child = child_mass.checked_add(transferred).ok_or(StolonsError::ArithmeticError)?;
    Ok((new_parent, new_child))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{GENESIS_SUPPLY, CHILD_BURN_ATOMS};

    #[test]
    fn first_generation_transfer_is_exactly_one_percent() {
        assert_eq!(root_mass_transfer(GENESIS_SUPPLY as u128, CHILD_BURN_ATOMS, GENESIS_SUPPLY).unwrap(), CHILD_BURN_ATOMS as u128);
    }

    #[test]
    fn transfer_conserves_total_mass() {
        let moved = root_mass_transfer(8_123_456_789, CHILD_BURN_ATOMS, GENESIS_SUPPLY).unwrap();
        let (parent, child) = validate_family_move(8_123_456_789, 91, moved).unwrap();
        assert_eq!(parent + child, 8_123_456_789 + 91);
    }

    #[test]
    fn rejects_zero_atom_transfer() {
        assert!(root_mass_transfer(1, CHILD_BURN_ATOMS, GENESIS_SUPPLY).is_err());
    }

    #[test]
    fn checked_math_rejects_overflow() {
        assert!(root_mass_transfer(u128::MAX, CHILD_BURN_ATOMS, 1).is_err());
    }

    #[test]
    fn repeated_recursive_moves_conserve_family_mass() {
        let family_total = GENESIS_SUPPLY as u128;
        let mut lineages = vec![family_total];
        let mut parent_index = 0;
        let mut successful_edges = 0;

        loop {
            let parent_mass = lineages[parent_index];
            let moved = match root_mass_transfer(parent_mass, CHILD_BURN_ATOMS, GENESIS_SUPPLY) {
                Ok(value) => value,
                Err(_) => break,
            };
            lineages[parent_index] -= moved;
            lineages.push(moved);
            parent_index = lineages.len() - 1;
            successful_edges += 1;
            assert_eq!(lineages.iter().copied().sum::<u128>(), family_total);
            assert!(successful_edges < 16);
        }
        // Each token begins with 1B supply; after seven recursive mutations
        // the child receives only 10 atoms and the following transfer floors
        // to zero. open_epoch must reject that last candidate round.
        assert_eq!(successful_edges, 7);
        assert_eq!(*lineages.last().unwrap(), 10);
    }
}


/// Cumulative 50/50 split: creator gets the one-atom remainder, without repeated dust bias.
pub fn split_fee_collection(previous: u128, amount: u64) -> Result<(u128, u64, u64)> {
    let total = previous.checked_add(amount as u128).ok_or(StolonsError::ArithmeticError)?;
    let creator_before = previous / 2 + previous % 2;
    let creator_after = total / 2 + total % 2;
    let creator = u64::try_from(creator_after - creator_before).map_err(|_| error!(StolonsError::ArithmeticError))?;
    Ok((total, creator, amount.checked_sub(creator).ok_or(StolonsError::ArithmeticError)?))
}
#[cfg(test)]
mod fee_tests {
    use super::*;
    #[test]
    fn split_conserves_and_has_no_repeated_dust_bias() {
        let (mut total, mut creator, mut treasury) = (0u128, 0u128, 0u128);
        for amount in [1, 1, 1, 1, 3, 0, u64::MAX, 37] {
            let (next, c, t) = split_fee_collection(total, amount).unwrap();
            assert_eq!(c as u128 + t as u128, amount as u128);
            total = next; creator += c as u128; treasury += t as u128;
            assert_eq!(creator, total / 2 + total % 2);
            assert_eq!(creator + treasury, total);
        }
        assert!(split_fee_collection(u128::MAX, 1).is_err());
    }
}
