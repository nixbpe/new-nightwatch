# Writing Style

Applies to prose in docs, agent and skill files, handoffs, reviews, commit messages and replies. State the fact, number or decision directly so the reader can act on it.

Keep as is, never reword for readability: headings that other files cite, rule and trace IDs (`SYS-`, `DB-`, `AC-`, candidate IDs), numbers and dates, inline code, code blocks, file paths, handoff field labels (`OWNER`, `PROOF`, `BLOCKER`) and status words (`Implemented`, `Deferred`, `source-complete`, `author-verified`, `observed pass`).

| Avoid                                                                                     | Write instead                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| "Not X, but Y" contrasts                                                                  | The actual impact or fact                                     |
| Filler openers (นอกจากนี้, อย่างไรก็ตาม, Additionally, Moreover)                          | Start with the subject or the fact                            |
| Inflated words (ยกระดับ, ครอบคลุมอย่างครบถ้วน, robust, comprehensive, seamless, leverage) | Name what is covered or why it matters, with the number or ID |
| Stacked qualifiers ("อาจจะมีแนวโน้มที่อาจ")                                               | One qualifier, only where the uncertainty is real             |
| A closing sentence that restates the paragraph                                            | End on the last concrete fact                                 |
| Dashes inside sentences                                                                   | Comma, colon or parentheses                                   |
| Decorative bold or emoji                                                                  | Bold only field labels and totals                             |
| Chat residue ("หวังว่าจะเป็นประโยชน์", "Let me know")                                     | Remove it                                                     |

Do not add facts, sources, owners or dates while tightening prose. If a sentence needs a missing detail, ask or report it as open.

## Documentation and comments

- Keep one canonical explanation. Link it instead of repeating rules, code walkthroughs or status in several files.
- Add docs for public contracts, operational steps and decisions or constraints the code cannot explain. Update existing docs when those contracts change. Routine refactors need no new README, plan, report or copied playbook.
- Prefer names, types, direct code and tests over explanatory comments. Keep non-obvious rationale, public API contracts, legal notices, functional compiler/lint directives and unavoidable dependency or protocol constraints. Remove narration, commented-out code and comments that restate the implementation within the assigned scope.
- Fix unclear code before writing a workaround explanation. Reuse existing enforcement for recurring mistakes; add a tool only when its saved work justifies its maintenance.
- Keep ordinary progress and final replies short. Give the result, relevant checks, real limits and commit when applicable; link details only when needed.
