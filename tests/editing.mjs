/* Edit game (/editgame.js) in each game but Yahtzee (see yahtzee.mjs):
   players moved and renamed once a game has started, and what goes with
   them — their scores, the turn or the deal, Undo, who You are, colours —
   and where a game keeps its order fixed. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, open, startGame, wait, drag, editNames, editRename, editPress } from './helpers.mjs';

const LIST = '.edit-game .roster';
const grips = (pg) => pg.evaluate(() => document.querySelectorAll('.edit-game .roster-grip').length);

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
