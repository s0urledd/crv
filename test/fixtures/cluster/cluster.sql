-- PostgreSQL database cluster dump
-- Dumped from database version 14.24
-- Dumped by pg_dumpall version 14.24
\connect -reuse-previous=on "dbname='participant-app-provider'"
COPY participant.lapi_parameters (ledger_end, participant_id, participant_pruned_up_to_inclusive, ledger_end_sequential_id, ledger_end_string_interning_id, ledger_end_publication_time) FROM stdin;
65	participant::local-fixture	\N	1	1	0
\.
\connect -reuse-previous=on "dbname='validator-app-provider'"
COPY validator.store_last_ingested_offsets (store_id, migration_id, last_ingested_offset) FROM stdin;
3	0	00000000000000003f
\.
