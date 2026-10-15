-- A live session with join code 123456 for trying the student flow locally.
insert into teachers (id, clerk_user_id, name) values ('11111111-1111-1111-1111-111111111111','local_teacher','Ms. Rivera');
insert into assignments (id, teacher_id, title, extraction_status) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Linear equations','ready');
insert into problems (id, assignment_id, position, label, text, answer_key) values
  ('33333333-3333-3333-3333-333333333331','22222222-2222-2222-2222-222222222222',0,'1','Solve \( 2x + 3 = 11 \).','\( x = 4 \)'),
  ('33333333-3333-3333-3333-333333333332','22222222-2222-2222-2222-222222222222',1,'2','Solve \( 5x - 7 = 3x + 9 \).','\( x = 8 \)');
insert into rubric_lines (problem_id, position, points, description) values
  ('33333333-3333-3333-3333-333333333331',0,1,'Correct setup'),('33333333-3333-3333-3333-333333333331',1,1,'Correct answer'),
  ('33333333-3333-3333-3333-333333333332',0,1,'Collects like terms'),('33333333-3333-3333-3333-333333333332',1,1,'Correct answer');
insert into class_sessions (id, assignment_id, teacher_id, join_code, status) values ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','123456','lobby');
