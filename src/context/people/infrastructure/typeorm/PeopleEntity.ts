import {
  Entity,
  Column,
  PrimaryColumn,
} from 'typeorm';


@Entity('people')
export class PeopleEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 100, unique: true })
  name: string;

  @Column('varchar', { length: 300, nullable: true })
  age: string;
}
