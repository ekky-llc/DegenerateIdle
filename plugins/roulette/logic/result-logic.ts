import * as _ from 'lodash';
import { prisma } from '../../../prisma/client';

import { Player } from '../../player/types/player';
import { Roulette, RoulettePlayerPlayState } from '../types/roulette';

import { SET_ROULETTE_PLAYERS, SET_ROULETTE_ROUND_BETS } from './index';

import IMPORTED_BETTING_PAYOUTS from './mapping/betting_payouts.json';
import IMPORTED_BETTING_OPTIONS from './mapping/betting_options.json';
import logger from '../../../utils/logger';
import { formatMoney } from '../../../utils/utilities';

interface BettingPayouts {
    [key: string]: number;
}

interface BettingOptions {
    [key: string]: number[];
}

const BETTING_PAYOUTS: BettingPayouts = {
    ...IMPORTED_BETTING_PAYOUTS,
};

const BETTING_OPTIONS: BettingOptions = {
    ...IMPORTED_BETTING_OPTIONS,
};

export async function PROCESS_ROULETTE_RESULTS(passedRoulleteRound: Roulette.RoulettePlay, roulletePlayers: Player.Player[], roulleteBets: Roulette.RoulettePlayerBet[]) {
    logger.info(`Calculating round results (ID: '${passedRoulleteRound?.id}').`);

    // Deep clones to ensure reference can't get changed elsewhere as these results should be final.
    const roulleteRound = _.cloneDeep(passedRoulleteRound);
    const players = _.cloneDeep(roulletePlayers);
    const bets = _.cloneDeep(roulleteBets);

    // Calculate everything in memory for players and bets
    const playerResults = [];
    const betResuts = [];
    for (let i = 0; i < players.length; i++) {
        const player = _.cloneDeep(players[i]);
        const playersBets = bets.filter((bet) => bet.playerId === player.id);

        let totalCalculated = 0;
        logger.info(`Calculating results for player (ID: '${player?.id}'), they have '${playersBets.length}' bets to review.`);
        for (let j = 0; j < playersBets.length; j++) {
            const playerBet = playersBets[j];
            if (roulleteRound && roulleteRound.winningNumber) {
                const isWinningBet = BETTING_OPTIONS[playerBet.bet].includes(roulleteRound.winningNumber);
                // Add the winning number to the bet
                playerBet.result = roulleteRound.winningNumber;
                if (isWinningBet) {
                    // Mark as a winning bet
                    playerBet.state = RoulettePlayerPlayState.WON;
                    // Calculate winning, and assign to player
                    const calculatedWinnings = playerBet.amount * BETTING_PAYOUTS[playerBet.bet];
                    totalCalculated = totalCalculated + calculatedWinnings;
                    logger.info(`Winning result for bet (ID: '${playerBet.id}') by player (ID: '${player?.id}'), calculated winnings were '${formatMoney(calculatedWinnings)}'.`);
                    player.availableFunds = player.availableFunds + calculatedWinnings;
                } else {
                    // Mark as a lost bet
                    logger.info(`Losing result for bet (ID: '${playerBet.id}') by player (ID: '${player?.id}'), calculated loss was '${formatMoney(playerBet.amount)}'.`);
                    let betAsNegative = playerBet.amount * -1;
                    totalCalculated = totalCalculated + betAsNegative;
                    playerBet.state = RoulettePlayerPlayState.LOST;
                }

                // Save calculated bet result to memory
                betResuts.push(playerBet);
            }
        }

        player.positionChange = totalCalculated;

        // Save calculated player result to memory
        playerResults.push(player);
    }

    // Update memory player and bet calculations
    SET_ROULETTE_ROUND_BETS(betResuts);
    SET_ROULETTE_PLAYERS(playerResults);

    // Update database player and bet calculations
    await UPDATE_PLAYER_BETS(betResuts);
    await UPDATE_PLAYERS(playerResults);

    logger.info(`Round results (ID: '${roulleteRound?.id}') have been calculated and saved.`);
}

async function UPDATE_PLAYER_BETS(bets: Roulette.RoulettePlayerBet[]) {
    for (let i = 0; i < bets.length; i++) {
        const { id, state, result } = bets[i];

        await prisma.roulettePlayerBet.update({
            where: {
                id: id,
            },
            data: {
                state,
                result,
            },
        });
    }
}

async function UPDATE_PLAYERS(players: Player.Player[]) {
    for (let i = 0; i < players.length; i++) {
        const { id, availableFunds } = players[i];

        await prisma.player.update({
            where: {
                id: id,
            },
            data: {
                availableFunds,
            },
        });
    }
}
