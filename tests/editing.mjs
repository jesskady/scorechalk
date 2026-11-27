/* Putting players in order, in every game but Yahtzee (see yahtzee.mjs):
   by dragging at the setup of Darts, Cribbage and Magic, and with Edit game
   (/editgame.js) once a game has started, players moved and renamed. What
   goes with a player — their scores, the turn or the deal, Undo, who You
   are, colours — and where a game keeps its order fixed. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, share, wait, drag, editNames, editRename, editPress } from './helpers.mjs';

const LIST = '.edit-game .roster';
const grips = (pg) => pg.evaluate(() => document.querySelectorAll('.edit-game .roster-grip').length);

/* The setups: a grip on each name, the list's order the order of play,
   and what goes with a name dragged — You are, and Cribbage's first deal. */
describe('Setting the order before the game', () => {
  test('Darts: the names change places, You are with them', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.click('#modeRow [data-players="3"]');
    for (const [i, n] of ['Ann', 'Bob', 'Cy'].entries()) await pg.type(`#name${i + 1}`, n);
    await pg.click('#meSel [data-me="2"]');            // you are Cy
    await drag(pg, '#names', 2, 0);
    assert.deepEqual(await pg.evaluate(() => [1, 2, 3].map((n) => $('name' + n).value)), ['Cy', 'Ann', 'Bob']);
    assert.equal(await pg.$eval('#meSel .is-on', (b) => b.textContent), 'Cy');
    await pg.click('#startBtn'); await wait(500);
    assert.deepEqual(await pg.evaluate(() => [S.players.map((p) => p.name), S.meIdx]), [['Cy', 'Ann', 'Bob'], 0]);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Cribbage: the first deal and You are go with the name dragged', async () => {
    const pg = await phone();
    await open(pg, '/cribbage/');
    await pg.evaluate(() => { setupNames = ['Ann', 'Bob', 'Cy']; setupN = 3; setupMe = 1; setupDealer = 2; renderSetup(); });
    await drag(pg, '#names', 0, 2);
    const on = (row) => pg.$eval(`#${row} .is-on`, (b) => b.textContent);
    assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('#names input')].map((i) => i.value)), ['Bob', 'Cy', 'Ann']);
    assert.equal(await on('youRow'), 'Bob');
    assert.equal(await on('dealRow'), 'Cy');
    await startGame(pg);
    assert.deepEqual(await pg.evaluate(() => [S.names, S.names[S.dealer], S.names[S.me]]), [['Bob', 'Cy', 'Ann'], 'Cy', 'Bob']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Magic: the names change places round the table', async () => {
    const pg = await phone();
    await open(pg, '/magic/#commander');
    await pg.evaluate(() => { setupNames = ['Ann', 'Bob', 'Cy', 'Dee']; renderSetup(); });
    await drag(pg, '#names', 3, 1);
    await pg.click('#startBtn'); await wait(500);
    assert.deepEqual(await pg.evaluate(() => S.names), ['Ann', 'Dee', 'Bob', 'Cy']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});

describe('Edit game', () => {
  test('Darts: scores, the turn, Undo and You go with each player', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.evaluate(() => openGame(newGame(['Ann', 'Bob', 'Cy'], 101, { meIdx: 2 })));
    await wait(300);
    const turn = (...ds) => pg.evaluate((ds) => { for (const n of ds) addDart(n); submitTurn(); }, ds);
    await turn(20, 20, 20);          // Ann 41
    await turn(5, 5, 5);             // Bob 86: Cy to throw
    await pg.evaluate(() => addDart(1));   // Cy's first dart

    await pg.click('#editBtn'); await wait(300);
    assert.deepEqual(await editNames(pg), ['Ann', 'Bob', 'Cy']);
    await drag(pg, LIST, 0, 2);
    await editRename(pg, 0, 'Bobby');
    await editPress(pg, 'Save');

    const look = () => pg.evaluate(() => ({
      names: S.players.map((p) => p.name), scores: S.players.map((p) => p.score),
      up: S.players[S.cur].name, me: toPayloadMe(), darts: S.darts.length,
    }));
    await pg.evaluate(() => { window.toPayloadMe = () => SCSync.toPayload(S).me_idx; });
    assert.deepEqual(await look(), { names: ['Bobby', 'Cy', 'Ann'], scores: [86, 101, 41], up: 'Cy', me: 1, darts: 1 },
      'Cy keeps the turn and the dart thrown, and is still you');

    // Undo takes each turn back from its own player
    await pg.evaluate(() => { S.darts = []; save(); render(); });
    await pg.click('#undoTurn'); await wait(300); await pg.click('#confirmYes'); await wait(300);
    assert.deepEqual((await look()).scores, [101, 101, 41]);
    assert.equal((await look()).up, 'Bobby');
    await pg.click('#undoTurn'); await wait(300); await pg.click('#confirmYes'); await wait(300);
    assert.deepEqual((await look()).scores, [101, 101, 101]);
    assert.equal((await look()).up, 'Ann');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Cribbage: pegs, colours and the deal go with each player; the count keeps its order', async () => {
    const pg = await phone();
    await open(pg, '/cribbage/');
    await pg.evaluate(() => { setupNames = ['Ann', 'Bob', 'Cy']; setupN = 3; setupDealer = 0; setupMe = 2; beginGame(); });
    await wait(500);
    const peg = (p, pts) => pg.evaluate((p, pts) => { score(p, pts, 'play', 'test'); save(); render(); }, p, pts);
    await peg(0, 2); await peg(1, 3); await peg(2, 4);
    const red = await pg.evaluate(() => document.getElementById('peg0').getAttribute('fill'));

    await pg.click('#editBtn'); await wait(300);
    await drag(pg, LIST, 0, 2);
    await editPress(pg, 'Save');
    const look = () => pg.evaluate(() => ({
      names: S.names, scores: S.scores, dealer: S.names[S.dealer], me: toPayload().me_idx,
    }));
    assert.deepEqual(await look(), { names: ['Bob', 'Cy', 'Ann'], scores: [3, 4, 2], dealer: 'Ann', me: 1 });
    assert.equal(await pg.evaluate(() => document.getElementById('peg2').getAttribute('fill')), red, "Ann's peg is still red");

    // Undo puts the last score back on Cy, wherever Cy now sits
    await pg.click('#undoBtn'); await wait(300);
    assert.deepEqual((await look()).scores, [3, 0, 2]);
    assert.deepEqual((await look()).names, ['Bob', 'Cy', 'Ann'], 'Undo keeps the new order');
    assert.equal(await pg.evaluate(() => document.getElementById('peg2').getAttribute('fill')), red);

    // the count: names only, the order stays
    await pg.click('#mainBtn'); await wait(300);
    await pg.click('#editBtn'); await wait(300);
    assert.equal(await grips(pg), 0, 'no grips while a hand is counted');
    assert.match(await pg.evaluate(() => document.querySelector('.edit-game p').textContent), /counted/);
    await editRename(pg, 2, 'Annie');
    await editPress(pg, 'Save');
    assert.deepEqual((await look()).names, ['Bob', 'Cy', 'Annie']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Magic: life, commander damage both ways and colour go with each player', async () => {
    const pg = await phone();
    await open(pg, '/magic/');
    await pg.evaluate(() => {
      S = newGame('commander', ['Ann', 'Bob', 'Cy'], 40);
      change(1, 'cmdr', 9, 0);      // Bob takes 9 from Ann's commander
      change(0, 'life', -5);
      save(); SCStore.show(S.id, '#play'); route();
    });
    await wait(500);
    const colour = (p) => pg.evaluate((p) => document.querySelectorAll('.panel')[p].style.getPropertyValue('--pc'), p);
    const annColour = await colour(0);

    await pg.click('#hubBtn'); await wait(200);
    await pg.click('#editBtn'); await wait(300);
    await drag(pg, LIST, 0, 2);
    await editPress(pg, 'Save');
    assert.deepEqual(await pg.evaluate(() => S.names), ['Bob', 'Cy', 'Ann']);
    assert.deepEqual(await pg.evaluate(() => S.life), [31, 40, 35]);
    assert.equal(await pg.evaluate(() => S.cmdr[0][2]), 9, "Bob's damage from Ann's commander");
    assert.equal(await colour(2), annColour, 'Ann keeps her colour');

    await pg.click('#hubBtn'); await wait(200);
    await pg.click('#undoBtn'); await wait(300);
    assert.deepEqual(await pg.evaluate(() => S.life), [31, 40, 40], "Undo gives Ann's life back to Ann");
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('The Builder: players move with their scores and the turn', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { mode: 'up', start: 0, win: 'none', turns: true, useRounds: false, teams: false, names: ['Jess', 'Alex', 'Sam'] }); cfg.players = 3; saveCfg(); renderSetup(); });
    await startGame(pg);
    await pg.click('#sheet button.cell.open[data-p="0"]'); await wait(300);
    await pg.evaluate(() => [...document.querySelectorAll('#quickpad .key')].find((k) => k.textContent === '+5').click());
    await pg.click('#commitBtn'); await wait(400);     // Jess 5: Alex is up

    await pg.click('#editBtn'); await wait(300);
    await drag(pg, LIST, 0, 2);
    await editPress(pg, 'Save');
    const look = () => pg.evaluate(() => ({ names: S.cfg.names, scores: S.scores, up: S.cfg.names[S.cur] }));
    assert.deepEqual(await look(), { names: ['Alex', 'Sam', 'Jess'], scores: [0, 0, 5], up: 'Alex' });
    await pg.click('#undoBtn'); await wait(300);
    assert.deepEqual(await look(), { names: ['Alex', 'Sam', 'Jess'], scores: [0, 0, 0], up: 'Jess' }, "Undo takes Jess's score back, and gives her the turn");

    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('The Builder: teams change places, each player with their side', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { mode: 'up', start: 0, win: 'none', turns: true, useRounds: false, teams: true, teamCount: 2, teamOf: [0, 1, 0, 1], names: ['Ann', 'Bob', 'Cy', 'Dee'] }); cfg.players = 4; saveCfg(); renderSetup(); });
    await startGame(pg);
    assert.deepEqual(await pg.evaluate(() => S.cfg.names), ['Ann & Cy', 'Bob & Dee']);
    await pg.click('#editBtn'); await wait(300);
    await drag(pg, LIST, 1, 0);
    await editPress(pg, 'Save');
    assert.deepEqual(await pg.evaluate(() => S.cfg.names), ['Bob & Dee', 'Ann & Cy']);
    assert.deepEqual(await pg.evaluate(() => S.cfg.playerTeams), [1, 0, 1, 0], 'each player is on the side that moved');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Bridge: names change, the seats stay', async () => {
    const pg = await phone();
    await open(pg, '/bridge/');
    for (const [i, n] of ['Ann', 'Bob', 'Cy', 'Dee'].entries()) await pg.type(`#n${i}`, n);
    await pg.click('#startBtn'); await wait(400);
    await pg.click('#editBtn'); await wait(300);
    assert.equal(await grips(pg), 0, 'the seats make the sides: nothing to drag');
    assert.deepEqual(await pg.evaluate(() => [...document.querySelectorAll('.edit-game li i')].map((i) => i.textContent)), ['N', 'E', 'S', 'W']);
    await editRename(pg, 1, 'Robert');
    await editPress(pg, 'Save');
    assert.deepEqual(await pg.evaluate(() => S.names), ['Ann', 'Robert', 'Cy', 'Dee']);
    assert.match(await pg.evaluate(() => document.getElementById('pad').textContent), /Robert & Dee/);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});

/* A new order part-way through a round: whoever has already played this
   round is passed over until everyone has, so no one plays twice in it.
   Save warns first when that will happen, and the game says so when it
   does; the next round starts at the top of the new list. Ann and Bob
   have played, it is Cy's turn, Dee is still to play; Cy, Ann, Dee, Bob
   would bring Ann round again before Dee. */
describe('Reordering part-way through a round', () => {
  const warning = (pg) => pg.evaluate(() => { const w = document.querySelector('.edit-game .edit-warn'); return w && !w.hidden ? w.querySelector('p').textContent : null; });
  // Cy, Ann, Dee, Bob: Cy to the top, then Dee above Bob
  async function reorder(pg) {
    await drag(pg, LIST, 2, 0);
    await drag(pg, LIST, 3, 2);
    assert.deepEqual(await editNames(pg), ['Cy', 'Ann', 'Dee', 'Bob']);
  }

  test('Yahtzee: a warning on Save, then the round finishes before Ann plays again', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await pg.evaluate(() => { S = newGame(['Ann', 'Bob', 'Cy', 'Dee']); openGame(S); setBox(0, 'ones', 3); setBox(1, 'ones', 2); save(); render(); });
    await wait(300);
    const up = () => pg.evaluate(() => S.names[S.cur]);
    assert.equal(await up(), 'Cy');

    await pg.click('#editBtn'); await wait(300);
    await reorder(pg);
    await editPress(pg, 'Save');
    assert.equal(await warning(pg),
      'Ann has already played this round, so they’ll be skipped until it’s over: after Cy, it’s Dee’s turn. The new order starts next round.');
    // Go back: the list as it was left, nothing saved
    await editPress(pg, 'Go back');
    assert.deepEqual(await editNames(pg), ['Cy', 'Ann', 'Dee', 'Bob']);
    assert.deepEqual(await pg.evaluate(() => S.names), ['Ann', 'Bob', 'Cy', 'Dee']);
    await editPress(pg, 'Save');
    await editPress(pg, 'Save');
    assert.deepEqual(await pg.evaluate(() => S.names), ['Cy', 'Ann', 'Dee', 'Bob']);

    const fill = async (p, id, pick) => {
      await pg.click(`#sheet button.cell[data-p="${p}"][data-id="${id}"]`); await wait(250);
      await pg.evaluate((t) => [...document.querySelectorAll('#entryBody button')].find((b) => b.textContent === t).click(), pick);
      await wait(300);
    };
    await fill(0, 'ones', '1');                      // Cy
    assert.equal(await up(), 'Dee', 'Ann is passed over: she has played this round');
    // said in full where it can be read, not squeezed into the title
    assert.deepEqual(await pg.evaluate(() => [toast.hidden, toast.textContent]), [false, 'Ann already played this round: Dee’s turn']);
    await pg.click('#toast'); await wait(100);
    assert.equal(await pg.evaluate(() => toast.hidden), true, 'a tap puts it away');
    await fill(2, 'ones', '4');                      // Dee: the round is done
    assert.equal(await up(), 'Cy', 'the next round starts at the top of the new list');
    assert.deepEqual(await pg.evaluate(() => S.names.map((_, p) => boxesFilled(p))), [1, 1, 1, 1], 'one box each');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Darts: the same, turn by turn', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.evaluate(() => openGame(newGame(['Ann', 'Bob', 'Cy', 'Dee'], 501, {})));
    await wait(300);
    const turn = () => pg.evaluate(() => { addDart(20); submitTurn(); });
    const up = () => pg.evaluate(() => S.players[S.cur].name);
    await turn(); await turn();                      // Ann, Bob
    await pg.click('#editBtn'); await wait(300);
    await reorder(pg);
    await editPress(pg, 'Save');
    assert.match(await warning(pg), /^Ann has already played this round/);
    await editPress(pg, 'Save');
    assert.equal(await up(), 'Cy');
    await turn();
    assert.equal(await up(), 'Dee');
    assert.equal(await pg.evaluate(() => $('msg').textContent), 'Ann already played this round: Dee’s turn');
    await turn();
    assert.equal(await up(), 'Cy');
    assert.deepEqual(await pg.evaluate(() => S.players.map((p) => p.turns)), [1, 1, 1, 1]);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('The Builder: the same; and a new order with no one to skip saves without asking', async () => {
    const pg = await phone();
    await open(pg, '/builder/');
    await pg.evaluate(() => { Object.assign(cfg, { mode: 'up', start: 0, win: 'none', turns: true, useRounds: false, teams: false, names: ['Ann', 'Bob', 'Cy', 'Dee'] }); cfg.players = 4; saveCfg(); renderSetup(); });
    await startGame(pg);
    const play = () => pg.evaluate(() => commit(5));
    const up = () => pg.evaluate(() => S.cfg.names[S.cur]);
    await play(); await play();                      // Ann, Bob
    await pg.click('#editBtn'); await wait(300);
    await reorder(pg);
    await editPress(pg, 'Save');
    assert.match(await warning(pg), /^Ann has already played this round/);
    await editPress(pg, 'Save');
    await play();                                    // Cy
    assert.equal(await up(), 'Dee');
    await play();                                    // Dee
    assert.equal(await up(), 'Cy');

    // at the top of a round no one has played yet: nothing to warn of
    await pg.click('#editBtn'); await wait(300);
    await drag(pg, LIST, 3, 0);
    await editPress(pg, 'Save');
    assert.equal(await pg.$('.edit-game'), null, 'saved straight away');
    assert.deepEqual(await pg.evaluate(() => S.cfg.names), ['Bob', 'Cy', 'Ann', 'Dee']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});

/* History, in Edit: the game's whole history, newest first, scrolling in
   the sheet; Back returns to the list. It shows in a locked game too,
   since looking changes nothing. */
describe('History in Edit', () => {
  const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll('.edit-history li')].map((li) =>
    [...li.querySelectorAll('.hwho, small, b')].map((x) => x.textContent.trim()).join(' | ')));

  test('Yahtzee: every box, newest first; Back returns to the players', async () => {
    const pg = await phone();
    await open(pg, '/yahtzee/');
    await pg.evaluate(() => { S = newGame(['Ann', 'Bob']); openGame(S); setBox(0, 'threes', 9); setBox(1, 'full', 25); setBox(0, 'small', 0); setBox(1, 'full', 0); save(); render(); });
    await wait(300);
    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    assert.equal(await pg.$eval('.edit-game h2', (h) => h.textContent), 'History');
    assert.deepEqual(await rows(pg), [
      'BobFull house changed |  | 25 → scratched',
      'AnnSm. straight | turn 2 | scratched',
      'BobFull house | turn 1 | 25',
      'AnnThrees | turn 1 | 9',
    ]);
    await editPress(pg, 'Back');
    assert.deepEqual(await editNames(pg), ['Ann', 'Bob'], 'back to the players');
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('Magic: a run of taps on one counter is one line', async () => {
    const pg = await phone();
    await open(pg, '/magic/');
    await pg.evaluate(() => {
      S = newGame('commander', ['Ann', 'Bob'], 40);
      for (let i = 0; i < 4; i++) change(0, 'life', -1);
      change(1, 'cmdr', 6, 0);
      save(); SCStore.show(S.id, '#play'); route();
    });
    await wait(500);
    await pg.click('#hubBtn'); await wait(200);
    await pg.click('#editBtn'); await wait(300);
    await editPress(pg, 'History');
    assert.deepEqual(await rows(pg), ['Bobfrom Ann’s commander |  | +6', 'Annlife |  | −4']);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });

  test('a shared game: locked for editing, its history still there to read', async () => {
    const pg = await phone();
    await open(pg, '/darts/');
    await pg.evaluate(() => openGame(newGame(['Ann', 'Bob'], 101, {})));
    await wait(300);
    await pg.evaluate(() => { for (const n of [20, 20, 1]) addDart(n); submitTurn(); });
    await share(pg);
    await pg.click('#editBtn'); await wait(300);
    assert.match(await pg.evaluate(() => document.querySelector('.edit-game p').textContent), /shared/);
    await editPress(pg, 'History');
    assert.deepEqual(await rows(pg), ['Ann20 20 1 | 101 → 60 | 41']);
    await editPress(pg, 'Back');
    await editPress(pg, 'OK');
    assert.equal(await pg.$('.edit-game'), null);
    assert.deepEqual(pg.errors, []);
    await pg.close();
  });
});
