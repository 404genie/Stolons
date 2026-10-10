use crate::{constants::CHILD_BURN_ATOMS, errors::StolonsError};
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
    use crate::constants::GENESIS_SUPPLY;

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

