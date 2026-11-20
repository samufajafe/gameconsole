import './styles.css';
import { ConsoleApp } from './console/ConsoleApp';
import type { GameDescriptor } from './console/GameDescriptor';
import { battleshipDescriptor } from './games/battleship/BattleshipView';
import { blackjackDescriptor } from './games/blackjack/BlackjackView';
import { racingDescriptor } from './games/racing/RacingView';

/** Catalogo de la consola. Agregar un juego es agregar su descriptor aqui. */
const juegos: GameDescriptor[] = [blackjackDescriptor, battleshipDescriptor, racingDescriptor];

new ConsoleApp(document.getElementById('app')!, juegos);
