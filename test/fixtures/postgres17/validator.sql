--
-- PostgreSQL database dump
--

\restrict QDcItwWjV8JPUAN5zC1Bbz4GoDnHsEoSIEHQQwpIhlZRpCrAjK9uQbMpp3P6zMw

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
-- Name: validator; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA validator;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: store_last_ingested_offsets; Type: TABLE; Schema: validator; Owner: -
--

CREATE TABLE validator.store_last_ingested_offsets (
    store_id bigint,
    migration_id bigint,
    last_ingested_offset text
);


--
-- Data for Name: store_last_ingested_offsets; Type: TABLE DATA; Schema: validator; Owner: -
--

COPY validator.store_last_ingested_offsets (store_id, migration_id, last_ingested_offset) FROM stdin;
3	0	00000000000000003f
4	0	00000000000000003f
\.


--
-- PostgreSQL database dump complete
--

\unrestrict QDcItwWjV8JPUAN5zC1Bbz4GoDnHsEoSIEHQQwpIhlZRpCrAjK9uQbMpp3P6zMw

