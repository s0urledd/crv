--
-- PostgreSQL database dump
--

\restrict VrygSPnIXlucUh4fIxebA0LtcUKvwwy4uoyNC3dZB6E8GHSo5xlKT13ZuTKGaMk

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: participant; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA participant;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: lapi_parameters; Type: TABLE; Schema: participant; Owner: -
--

CREATE TABLE participant.lapi_parameters (
    ledger_end bigint,
    participant_id text,
    participant_pruned_up_to_inclusive bigint,
    ledger_end_sequential_id bigint,
    ledger_end_string_interning_id bigint,
    ledger_end_publication_time text
);


--
-- Data for Name: lapi_parameters; Type: TABLE DATA; Schema: participant; Owner: -
--

COPY participant.lapi_parameters (ledger_end, participant_id, participant_pruned_up_to_inclusive, ledger_end_sequential_id, ledger_end_string_interning_id, ledger_end_publication_time) FROM stdin;
65	participant::postgres17-fixture	\N	1	1	0
\.


--
-- PostgreSQL database dump complete
--

\unrestrict VrygSPnIXlucUh4fIxebA0LtcUKvwwy4uoyNC3dZB6E8GHSo5xlKT13ZuTKGaMk
