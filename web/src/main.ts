import './styles.css';
import { ConsoleApp } from './console/ConsoleApp';
import type { GameDescriptor } from './console/GameDescriptor';
import { blackjackDescriptor } from './games/blackjack/BlackjackView';

/** Catalogo de la consola. Agregar un juego es agregar su descriptor aqui. */
const juegos: GameDescriptor[] = [blackjackDescriptor];

new ConsoleApp(document.getElementById('app')!, juegos);
